import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { ContractConfigurationError, BlockchainUnavailableError } from '@/lib/contractReads';
import { unixSecondsToIso } from '@/lib/credentialStatus';
import { readOnChainStatus } from '@/lib/onChainStatus';
import { enforceRateLimit, getRateLimiterMode } from '@/lib/rateLimit';
import {
    writeVerificationAuditLog,
    type VerificationResultType,
} from '@/lib/verificationAudit';
import { captureException, recordMetric } from '@/lib/debug';
import { hashApiKey } from '@/lib/apiKey';
import { RESPONSE_CACHE_MAX_AGE_SECONDS } from '@/lib/verificationCache';

// Dynamic rendering is required because we read request headers (IP, API key).
// The response Cache-Control header allows CDN/browser caching of the payload.
export const dynamic = 'force-dynamic';

/** Token IDs are the contract's u64 counter: decimal digits only. */
const TOKEN_ID_PATTERN = /^\d{1,20}$/;
const U64_MAX = BigInt('18446744073709551615');

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

const RESULT_TYPE_BY_STATUS = {
    valid: 'verified',
    revoked: 'revoked',
    expired: 'expired',
} as const satisfies Record<string, VerificationResultType>;

function isTokenId(token: string): boolean {
    return TOKEN_ID_PATTERN.test(token) && BigInt(token) <= U64_MAX;
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
        };
        errorCategory?: string;
        apiKeyContext?: { id: string; name: string } | null;
    } = {},
) {
    recordMetric('verification.attempt', 1, {
        resultType,
        statusCode,
        credentialId: options.credentialId,
        chain: options.chain,
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
        errorCategory: options.errorCategory,
        apiKeyContext: options.apiKeyContext,
    });
}

/**
 * Display labels that only the database holds: the institution's name, and
 * which on-chain event revoked the credential. They never decide the result;
 * a missing or unreachable row just means the label is absent.
 */
async function readDisplayLabels(supabase: ServiceRoleClient, tokenId: string, issuer: string) {
    const [credentialRow, institutionRow] = await Promise.all([
        supabase
            .from('credentials')
            .select('id, revoked_at, revocation_source')
            .eq('token_id', tokenId)
            .maybeSingle()
            .then(
                ({ data }) => data,
                () => null,
            ),
        supabase
            .from('institutions')
            .select('name')
            .eq('wallet_address', issuer)
            .maybeSingle()
            .then(
                ({ data }) => data,
                () => null,
            ),
    ]);

    const revocationSource = credentialRow?.revocation_source;
    return {
        credentialId: (credentialRow?.id as string | undefined) ?? null,
        revokedAt: (credentialRow?.revoked_at as string | null | undefined) ?? null,
        revocationSource:
            revocationSource === 'issuer' || revocationSource === 'platform'
                ? (revocationSource as 'issuer' | 'platform')
                : null,
        institutionName: (institutionRow?.name as string | undefined) ?? null,
    };
}

/**
 * GET /api/verify/:tokenId
 *
 * Status-only verification by token ID (review §3.11b). Everything that
 * decides the answer is read from the contract: whether the credential
 * exists, its issuer, dates, revocation, expiry, and whether the issuer is
 * still authorized. Nothing personal is returned. The holder's name, degree
 * and document are only reachable through their share link.
 */
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

        if (providedKey) {
            const keyHash = await hashApiKey(providedKey);
            const { data: keyData, error: keyError } = await supabase
                .from('api_keys')
                .select('id, name, revoked')
                .eq('key_hash', keyHash)
                .maybeSingle();

            if (keyError) {
                return NextResponse.json(
                    { success: false, error: 'Database error validating API key' },
                    { status: 500 },
                );
            }

            if (!keyData || keyData.revoked) {
                return NextResponse.json(
                    { success: false, error: 'Invalid or revoked API key' },
                    { status: 401 },
                );
            }

            apiKeyContext = { id: keyData.id, name: keyData.name };
        }

        // Issue #229: Fail closed in production if Upstash is not configured.
        // This endpoint is the most exposed to abuse (it burns RPC quota).
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
                : VERIFY_RATE_LIMIT,
        );

        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        if (!isTokenId(token)) {
            await logVerificationAttempt(supabase, request, token, 'invalid_request', 400, {
                errorCategory: 'invalid_token_id',
                apiKeyContext,
            });

            return NextResponse.json(
                { success: false, error: 'Invalid token ID' },
                { status: 400 },
            );
        }

        const tokenId = token;

        const chainStatus = await readOnChainStatus(tokenId);

        if (!chainStatus) {
            await logVerificationAttempt(supabase, request, token, 'not_found', 404, {
                chain: { found: false },
                apiKeyContext,
            });

            return NextResponse.json(
                { success: false, error: 'Credential not found' },
                { status: 404 },
            );
        }

        const { onChain, status, revoked, issuerAuthorized } = chainStatus;
        recordMetric('verification.cache.status', 1, { ...chainStatus.cache, tokenId });

        const labels = await readDisplayLabels(supabase, tokenId, onChain.issuer);
        credentialId = labels.credentialId;
        const revocationSource = revoked ? labels.revocationSource : null;

        await logVerificationAttempt(supabase, request, token, RESULT_TYPE_BY_STATUS[status], 200, {
            credentialId,
            chain: { found: true, revoked },
            apiKeyContext,
        });

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
                    tokenId,
                    status,
                    issuedAt: unixSecondsToIso(onChain.issuedAt),
                    expiresAt: unixSecondsToIso(onChain.expiresAt),
                    revoked,
                    revokedAt: revoked ? labels.revokedAt : null,
                    revocationSource,
                    institutionName: labels.institutionName,
                    institutionWallet: onChain.issuer,
                    onChainHash: onChain.hash,
                },
                verification: {
                    verified: status === 'valid',
                    status,
                    revoked,
                    expired: status === 'expired',
                    revocationSource,
                    onChainFound: true,
                    issuerAuthorized,
                    issuerStatus: issuerAuthorized ? 'active' : 'revoked',
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
