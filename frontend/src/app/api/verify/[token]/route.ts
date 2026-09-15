import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/serverAuth';
import {
    getCredential,
    isAuthorizedIssuer,
    isRevoked,
    ContractConfigurationError,
    BlockchainUnavailableError,
} from '@/lib/contractReads';
import { deriveCredentialHash } from '@/lib/credentialHash';
import { fetchJsonFromIpfs } from '@/lib/ipfsServer';
import { enforceRateLimit, getRateLimiterMode } from '@/lib/rateLimit';
import {
    writeVerificationAuditLog,
    type VerificationResultType,
} from '@/lib/verificationAudit';
import { captureException, recordMetric } from '@/lib/debug';
import { hashApiKey } from '@/lib/apiKey';
import {
    getCachedImmutableData,
    setCachedImmutableData,
    getCachedRevocationStatus,
    setCachedRevocationStatus,
    RESPONSE_CACHE_MAX_AGE_SECONDS,
} from '@/lib/verificationCache';

export type IntegrityStatus = 'match' | 'mismatch' | 'unavailable';

export interface IntegrityResult {
    status: IntegrityStatus;
    cidResolved: boolean;
}

// Dynamic rendering is required because we read request headers (IP, API key).
// The response Cache-Control header allows CDN/browser caching of the payload.
export const dynamic = 'force-dynamic';

const MAX_TOKEN_LENGTH = 128;

const VERIFY_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'verify',
} as const;

const VERIFY_API_KEY_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 600,
    prefix: 'verify-apikey',
} as const;

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

type ChainChecks = {
    issuerMatch: boolean | null;
    studentMatch: boolean | null;
    hashMatch: boolean | null;
    uriMatch: boolean | null;
    notRevoked: boolean;
};

// Removed unused getErrorMessage

function getMismatchReasons(checks: ChainChecks | null) {
    if (!checks) {
        return ['missing_on_chain'];
    }

    const reasons: string[] = [];
    if (checks.issuerMatch !== true) reasons.push('issuer');
    if (checks.studentMatch !== true) reasons.push('student');
    if (checks.hashMatch !== true) reasons.push('hash');
    if (checks.uriMatch !== true) reasons.push('uri');
    if (!checks.notRevoked) reasons.push('revocation');
    return reasons;
}

function getResultType(verified: boolean, revoked: boolean): VerificationResultType {
    if (verified) {
        return 'verified';
    }

    if (revoked) {
        return 'revoked';
    }

    return 'mismatch';
}

/**
 * Independently confirms that the CID the contract actually points to
 * (`onChainUri`) resolves and that its content hashes to the same value as
 * the on-chain `credential_hash`. This is deliberately separate from
 * `checks.hashMatch` above, which only proves the *database's cached copy*
 * of the metadata matches the chain — it says nothing about whether the
 * document a real verifier would fetch from IPFS is the same bytes. See
 * ACREDIA-STELLAR#163.
 */
async function checkIntegrity(
    onChainUri: string | null | undefined,
    onChainHash: string | null | undefined,
    metadataSchemaVersion: number | null | undefined,
    hashAlgorithm: string | null | undefined,
): Promise<IntegrityResult> {
    if (!onChainUri || !onChainHash) {
        return { status: 'unavailable', cidResolved: false };
    }

    const fetched = await fetchJsonFromIpfs(onChainUri);
    if (!fetched.ok) {
        return { status: 'unavailable', cidResolved: false };
    }

    try {
        const fetchedHash = await deriveCredentialHash(
            fetched.content,
            metadataSchemaVersion,
            hashAlgorithm,
        );
        return {
            status: fetchedHash === onChainHash ? 'match' : 'mismatch',
            cidResolved: true,
        };
    } catch {
        // Content resolved but isn't a canonicalizable document for the
        // recorded schema version — can't be judged authentic or tampered.
        return { status: 'unavailable', cidResolved: true };
    }
}

async function logVerificationAttempt(
    supabase: ServiceRoleClient | null,
    request: NextRequest,
    token: string | null,
    resultType: VerificationResultType,
    statusCode: number,
    options: {
        credentialId?: string | null;
        chain?: {
            found?: boolean;
            revoked?: boolean;
            match?: boolean;
        };
        integrity?: IntegrityResult;
        mismatchReasons?: string[];
        errorCategory?: string;
        apiKeyContext?: { id: string; name: string } | null;
    } = {},
) {
    recordMetric('verification.attempt', 1, {
        resultType,
        statusCode,
        credentialId: options.credentialId,
        chain: options.chain,
        integrityStatus: options.integrity?.status,
        errorCategory: options.errorCategory,
    });

    if (!supabase || !token) {
        return;
    }

    await writeVerificationAuditLog(supabase, {
        request,
        token,
        resultType,
        statusCode,
        credentialId: options.credentialId,
        chain: options.chain,
        integrity: options.integrity,
        mismatchReasons: options.mismatchReasons,
        errorCategory: options.errorCategory,
        apiKeyContext: options.apiKeyContext,
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    let supabase: ServiceRoleClient | null = null;
    let token: string | null = null;
    let credentialId: string | null = null;
    let apiKeyContext: { id: string; name: string } | null = null;

    try {
        const { token: rawToken } = await params;
        token = rawToken?.trim() || null;

        if (!token) {
            return NextResponse.json(
                { success: false, error: 'Token is required' },
                { status: 400 },
            );
        }

        try {
            supabase = getServiceRoleClient();
        } catch {
            supabase = null;
        }

        if (!supabase) {
            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500 },
            );
        }

        const authHeader = request.headers.get('authorization');
        const xApiKey = request.headers.get('x-api-key');
        let providedKey = xApiKey?.trim();
        if (!providedKey && authHeader?.toLowerCase().startsWith('bearer ')) {
            providedKey = authHeader.substring(7).trim();
        }

        if (providedKey && supabase) {
            const keyHash = await hashApiKey(providedKey);
            const { data: keyData, error: keyError } = await supabase
                .from('api_keys')
                .select('id, name, revoked')
                .eq('key_hash', keyHash)
                .maybeSingle();

            if (keyError) {
                return NextResponse.json(
                    { success: false, error: 'Database error validating API key' },
                    { status: 500 }
                );
            }

            if (!keyData || keyData.revoked) {
                return NextResponse.json(
                    { success: false, error: 'Invalid or revoked API key' },
                    { status: 401 }
                );
            }
            
            apiKeyContext = { id: keyData.id, name: keyData.name };
        }

        // Issue #229: Fail closed in production if Upstash is not configured.
        // This endpoint is the most exposed to abuse (burns RPC quota and IPFS bandwidth).
        if (
            process.env.NODE_ENV === 'production' &&
            getRateLimiterMode() === 'in-memory-unconfigured'
        ) {
            await logVerificationAttempt(supabase, request, token, 'server_error', 500, {
                errorCategory: 'rate_limiter_unconfigured',
                apiKeyContext,
            });
            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500 },
            );
        }

        const rateLimitResponse = await enforceRateLimit(
            request,
            apiKeyContext
                ? { ...VERIFY_API_KEY_RATE_LIMIT, identifier: apiKeyContext.id }
                : VERIFY_RATE_LIMIT
        );

        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        if (token.length > MAX_TOKEN_LENGTH) {
            await logVerificationAttempt(supabase, request, token, 'invalid_request', 400, {
                errorCategory: 'token_too_long',
            });

            return NextResponse.json(
                { success: false, error: 'Invalid token' },
                { status: 400 },
            );
        }

        const { data, error } = await supabase
            .from('credentials')
            .select(
                `
                id,
                token_id,
                issued_at,
                revoked,
                revoked_at,
                metadata,
                metadata_schema_version,
                hash_algorithm,
                ipfs_hash,
                blockchain_hash,
                student_wallet_address,
                issuer_wallet_address,
                institution:institutions!credentials_institution_id_fkey (
                    name
                )
            `,
            )
            .eq('token_id', token)
            .maybeSingle();

        if (error) {
            await logVerificationAttempt(supabase, request, token, 'server_error', 500, {
                errorCategory: 'database_query_failed',
                apiKeyContext,
            });

            return NextResponse.json(
                { success: false, error: 'Failed to query credential' },
                { status: 500 },
            );
        }

        const tokenId = token;

        // ------------------------------------------------------------------
        // Cache layer — Issue #228
        // Immutable data (on-chain credential + IPFS integrity) is cached with
        // a long TTL. Revocation status uses a short TTL so that a revocation
        // event propagates to verifiers within its documented window.
        // All cache helpers return `null` on a miss or Redis unavailability
        // so we fall through to the live chain/IPFS path transparently.
        // ------------------------------------------------------------------

        // 1. Try the immutable cache (skips RPC + IPFS fetch on a hit).
        const cachedImmutable = await getCachedImmutableData(tokenId);
        let onChain = cachedImmutable?.onChain ?? null;
        let integrity = cachedImmutable?.integrity ?? null;
        const immutableCacheHit = cachedImmutable !== null;

        // 3. On an immutable cache miss, do the real chain + IPFS work.
        if (!immutableCacheHit) {
            onChain = await getCredential(tokenId);
        }

        // If neither the database index nor the blockchain record exists, 404.
        if (!data && !onChain) {
            await logVerificationAttempt(supabase, request, token, 'not_found', 404, { apiKeyContext });

            return NextResponse.json(
                { success: false, error: 'Credential not found' },
                { status: 404 },
            );
        }

        // Issue #232: Synthesize credential record if database row is absent / pruned / erased.
        const credentialRecord = data ?? {
            id: undefined,
            token_id: tokenId,
            issued_at: onChain?.issued_at ? new Date(Number(onChain.issued_at)).toISOString() : new Date().toISOString(),
            revoked: onChain?.revoked ?? false,
            revoked_at: null,
            metadata: null,
            metadata_schema_version: 1,
            hash_algorithm: 'sha256:canonical-json:v1',
            ipfs_hash: onChain?.uri ? onChain.uri.replace(/^ipfs:\/\//, '') : '',
            blockchain_hash: onChain?.hash ?? '',
            student_wallet_address: onChain?.student ?? null,
            issuer_wallet_address: onChain?.issuer ?? null,
            institution: null,
        };

        credentialId = credentialRecord.id;

        if (!immutableCacheHit) {
            integrity = await checkIntegrity(
                onChain?.uri,
                onChain?.hash,
                credentialRecord.metadata_schema_version,
                credentialRecord.hash_algorithm,
            );
            // Write immutable results to cache in the background — don't block.
            void setCachedImmutableData(tokenId, {
                onChain,
                integrity: integrity ?? { status: 'unavailable', cidResolved: false },
            });
        }

        // 2. Revocation is always re-checked with its own short TTL.
        let cachedRevoked = await getCachedRevocationStatus(tokenId);
        const revocationCacheHit = cachedRevoked !== null;

        // 4. On a revocation cache miss, fetch live and cache the result.
        if (!revocationCacheHit) {
            cachedRevoked = await isRevoked(tokenId);
            void setCachedRevocationStatus(tokenId, cachedRevoked);
        }
        const onChainRevoked = cachedRevoked ?? false;

        // issuerAuthorized is not cached — it's a cheap single Supabase lookup
        // and is not on the hot path of repeated public verification.
        const issuerWallet = credentialRecord.issuer_wallet_address || onChain?.issuer;
        const issuerAuthorized =
            issuerWallet && typeof isAuthorizedIssuer === 'function'
                ? await isAuthorizedIssuer(issuerWallet)
                : false;

        recordMetric('verification.cache.status', 1, {
            immutableHit: immutableCacheHit,
            revocationHit: revocationCacheHit,
            tokenId,
        });

        const dbHash = credentialRecord.metadata
            ? await deriveCredentialHash(
                  credentialRecord.metadata,
                  credentialRecord.metadata_schema_version,
                  credentialRecord.hash_algorithm,
              )
            : null;
        const expectedUri = credentialRecord.ipfs_hash ? `ipfs://${credentialRecord.ipfs_hash}` : (onChain?.uri ?? null);

        // integrity is guaranteed non-null here: either from cache or from
        // the live checkIntegrity() call above. Fall back defensively.
        const safeIntegrity: IntegrityResult = integrity ?? { status: 'unavailable', cidResolved: false };

        const checks: ChainChecks | null = onChain
            ? {
                  issuerMatch: credentialRecord.issuer_wallet_address
                      ? onChain.issuer.toLowerCase() === credentialRecord.issuer_wallet_address.toLowerCase()
                      : true,
                  studentMatch: credentialRecord.student_wallet_address
                      ? onChain.student.toLowerCase() === credentialRecord.student_wallet_address.toLowerCase()
                      : true,
                  // `hashMatch` answers one narrow question: does the database's
                  // cached hash agree with the chain? With no cached hash there
                  // is nothing to disagree, so the check is not applicable and
                  // must not fail — document integrity is reported separately
                  // via `safeIntegrity`, and folding it in here would make an
                  // IPFS gateway outage render valid credentials as unverified.
                  //
                  // The previous expression was
                  //   dbHash ? … : (status === 'verified' || status === 'match' || !dbHash)
                  // whose else-branch always evaluated to true via `!dbHash`,
                  // while `status === 'verified'` was dead code ('verified' is
                  // not in IntegrityStatus). Same behaviour, stated plainly.
                  hashMatch: dbHash ? onChain.hash === dbHash : true,
                  uriMatch: expectedUri ? onChain.uri === expectedUri : true,
                  notRevoked: !onChainRevoked,
              }
            : null;

        const onChainMatch =
            checks !== null &&
            checks.issuerMatch === true &&
            checks.studentMatch === true &&
            checks.hashMatch === true &&
            checks.uriMatch === true;

        const revoked = Boolean(onChainRevoked || credentialRecord.revoked);
        const verified = onChain !== null && onChainMatch && !revoked;
        const resultType = getResultType(verified, revoked);

        const mismatchReasons = [
            ...(resultType === 'mismatch' ? getMismatchReasons(checks) : []),
            ...(safeIntegrity.status === 'mismatch' ? ['ipfs_integrity'] : []),
        ];

        // Audit log is unconditional — every attempt is recorded whether the
        // result came from cache or from live chain/IPFS reads.
        await logVerificationAttempt(supabase, request, token, resultType, 200, {
            credentialId,
            chain: {
                found: onChain !== null,
                revoked,
                match: onChainMatch,
            },
            integrity: safeIntegrity,
            mismatchReasons,
            apiKeyContext,
        });

        const institution = Array.isArray(credentialRecord.institution)
            ? credentialRecord.institution[0]
            : credentialRecord.institution;

        const credentialData = credentialRecord.metadata?.credentialData ?? {};

        // HTTP Cache-Control: CDN/browsers may cache this public response for the
        // same duration as the revocation TTL — ensuring a revocation event
        // propagates to all cached copies within the documented window.
        // stale-while-revalidate lets CDNs serve the old response while they
        // refresh it in the background, preventing latency spikes on expiry.
        const cacheControl = `public, s-maxage=${RESPONSE_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=30`;

        return NextResponse.json(
            {
                success: true,
                credential: {
                    tokenId: credentialRecord.token_id,
                    issuedAt: credentialRecord.issued_at,
                    revoked,
                    revokedAt: credentialRecord.revoked_at,
                    institutionName: institution?.name ?? credentialData.institutionName ?? null,
                    credentialType: credentialData.credentialType ?? null,
                    degree: credentialData.degree ?? null,
                    major: credentialData.major ?? null,
                    issueDate: credentialData.issueDate ?? null,
                    // Stellar account addresses, not sensitive: already readable
                    // on-chain by anyone who queries this token_id directly.
                    studentWallet: onChain?.student ?? credentialRecord.student_wallet_address ?? null,
                    institutionWallet: onChain?.issuer ?? credentialRecord.issuer_wallet_address ?? null,
                    metadataSchemaVersion: credentialRecord.metadata_schema_version ?? null,
                    hashAlgorithm: credentialRecord.hash_algorithm ?? null,
                    onChainHash: onChain?.hash ?? null,
                    blockchainHash: credentialRecord.blockchain_hash ?? onChain?.hash ?? null,
                    ipfsHash: credentialRecord.ipfs_hash ?? (onChain?.uri ? onChain.uri.replace(/^ipfs:\/\//, '') : null),
                },
                verification: {
                    verified,
                    revoked,
                    onChainMatch,
                    onChainFound: onChain !== null,
                    issuerAuthorized,
                    issuerStatus: issuerAuthorized ? 'active' : 'revoked',
                    // Distinct from `revoked`/`onChainFound`: proves the actual
                    // IPFS-hosted document — not the DB's cached copy — hashes to
                    // the on-chain value. 'unavailable' means the CID couldn't be
                    // resolved/checked, not that anything is wrong.
                    integrity: safeIntegrity,
                },
            },
            {
                headers: { 'Cache-Control': cacheControl },
            },
        );
    } catch (err: unknown) {
        if (err instanceof ContractConfigurationError) {
            captureException(err, { requestId, context: 'GET /api/verify/[token]' });
            await logVerificationAttempt(supabase, request, token, 'chain_unavailable', 500, {
                credentialId,
                errorCategory: 'contract_configuration',
                apiKeyContext,
            });

            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500 },
            );
        }

        if (err instanceof BlockchainUnavailableError) {
            captureException(err, { requestId, context: 'GET /api/verify/[token]' });
            await logVerificationAttempt(supabase, request, token, 'chain_unavailable', 503, {
                credentialId,
                errorCategory: 'contract_read_failed',
                apiKeyContext,
            });

            return NextResponse.json(
                { success: false, error: 'Blockchain verification unavailable' },
                { status: 503 },
            );
        }

        await logVerificationAttempt(supabase, request, token, 'server_error', 500, {
            credentialId,
            errorCategory: 'unexpected_error',
            apiKeyContext,
        });
        captureException(err, { requestId, context: 'GET /api/verify/[token]' });

        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 },
        );
    }
}
