import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { ContractConfigurationError, BlockchainUnavailableError } from '@/lib/contractReads';
import { CREDENTIAL_DOCUMENTS_BUCKET } from '@/lib/credentialDocuments';
import { unixSecondsToIso } from '@/lib/credentialStatus';
import { readOnChainStatus } from '@/lib/onChainStatus';
import { isShareToken, verifyStoredCredential } from '@/lib/sharedCredential';
import { enforceRateLimit, getRateLimiterMode } from '@/lib/rateLimit';
import { writeVerificationAuditLog, type VerificationResultType } from '@/lib/verificationAudit';
import { captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const SHARE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'credential-share',
} as const;

/** Signed document URLs are short-lived; reloading the page issues a new one. */
const DOCUMENT_URL_TTL_SECONDS = 300;

// Personal data and a signed URL: never cached by a CDN or shared cache.
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

const RESULT_TYPE_BY_STATUS = {
    valid: 'verified',
    revoked: 'revoked',
    expired: 'expired',
} as const satisfies Record<string, VerificationResultType>;

function notFound() {
    return NextResponse.json(
        { success: false, error: 'Credential not found' },
        { status: 404, headers: NO_STORE },
    );
}

async function signDocumentUrl(supabase: ServiceRoleClient, path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
        .from(CREDENTIAL_DOCUMENTS_BUCKET)
        .createSignedUrl(path, DOCUMENT_URL_TTL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * GET /api/credentials/share/:shareToken
 *
 * What the holder's share link shows (review §3.11b): the credential's
 * status from the contract, plus its content and document once the stored
 * content is proven to hash to the on-chain value. Content that does not
 * match is withheld, not shown with a warning.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ shareToken: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    let supabase: ServiceRoleClient | null = null;
    let tokenId: string | null = null;
    let credentialId: string | null = null;

    const log = async (
        resultType: VerificationResultType,
        statusCode: number,
        extra: { errorCategory?: string; mismatchReasons?: string[]; chain?: { found?: boolean; revoked?: boolean } } = {},
    ) => {
        if (!supabase) return;
        await writeVerificationAuditLog(supabase, {
            request,
            token: tokenId,
            credentialId,
            resultType,
            statusCode,
            ...extra,
        });
    };

    try {
        const { shareToken: rawToken } = await params;
        const shareToken = rawToken?.trim() ?? '';

        // Issue #229: fail closed in production without a shared rate limiter.
        if (
            process.env.NODE_ENV === 'production' &&
            getRateLimiterMode() === 'in-memory-unconfigured'
        ) {
            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500, headers: NO_STORE },
            );
        }

        const rateLimitResponse = await enforceRateLimit(request, SHARE_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        // A malformed token cannot match any credential; answer like a miss.
        if (!isShareToken(shareToken)) {
            return notFound();
        }

        supabase = getServiceRoleClient();
        const { data: row, error } = await supabase
            .from('credentials')
            .select(
                `id, token_id, metadata, metadata_schema_version, hash_algorithm,
                 document_path, document_sha256, blockchain_hash, revoked_at, revocation_source`,
            )
            .eq('share_token', shareToken.toLowerCase())
            .maybeSingle();

        if (error) {
            throw error;
        }
        if (!row) {
            return notFound();
        }

        credentialId = row.id as string;
        tokenId = String(row.token_id);

        const chainStatus = await readOnChainStatus(tokenId);
        if (!chainStatus) {
            await log('not_found', 404, { chain: { found: false } });
            return notFound();
        }

        const { onChain, status, revoked, issuerAuthorized } = chainStatus;
        const content = await verifyStoredCredential({
            metadata: row.metadata,
            schemaVersion: (row.metadata_schema_version as number | null) ?? null,
            hashAlgorithm: (row.hash_algorithm as string | null) ?? null,
            onChainHash: onChain.hash,
            onChainStudent: onChain.student,
        });

        const { data: institution } = await supabase
            .from('institutions')
            .select('name')
            .eq('wallet_address', onChain.issuer)
            .maybeSingle();

        // The document is served only when its stored digest is the one the
        // hashed credential records. The viewer's browser re-checks the bytes.
        let document: { url: string; sha256: string; expiresInSeconds: number } | null = null;
        let documentStatus: 'available' | 'none' | 'unavailable' = 'none';
        if (content.ok && content.documentSha256) {
            const url =
                row.document_path && row.document_sha256 === content.documentSha256
                    ? await signDocumentUrl(supabase, row.document_path as string)
                    : null;
            document = url
                ? { url, sha256: content.documentSha256, expiresInSeconds: DOCUMENT_URL_TTL_SECONDS }
                : null;
            documentStatus = url ? 'available' : 'unavailable';
        }

        const revocationSource =
            revoked && (row.revocation_source === 'issuer' || row.revocation_source === 'platform')
                ? (row.revocation_source as 'issuer' | 'platform')
                : null;
        const verified = status === 'valid' && content.ok;

        await log(content.ok ? RESULT_TYPE_BY_STATUS[status] : 'mismatch', 200, {
            chain: { found: true, revoked },
            mismatchReasons: content.ok ? [] : [content.reason],
        });

        return NextResponse.json(
            {
                success: true,
                credential: {
                    tokenId,
                    status,
                    issuedAt: unixSecondsToIso(onChain.issuedAt),
                    expiresAt: unixSecondsToIso(onChain.expiresAt),
                    revoked,
                    revokedAt: revoked ? ((row.revoked_at as string | null) ?? null) : null,
                    revocationSource,
                    institutionName: (institution?.name as string | undefined) ?? null,
                    institutionWallet: onChain.issuer,
                    studentWallet: onChain.student,
                    onChainHash: onChain.hash,
                    transactionHash: (row.blockchain_hash as string | null) ?? null,
                    details: content.ok ? content.details : null,
                    // The exact anchored document, for the standards export.
                    metadata: content.ok ? row.metadata : null,
                    metadataSchemaVersion: content.ok ? row.metadata_schema_version : null,
                    hashAlgorithm: content.ok ? row.hash_algorithm : null,
                    document,
                    documentStatus,
                },
                verification: {
                    verified,
                    status,
                    contentMatches: content.ok,
                    mismatchReason: content.ok ? null : content.reason,
                    revoked,
                    expired: status === 'expired',
                    revocationSource,
                    issuerAuthorized,
                    issuerStatus: issuerAuthorized ? 'active' : 'revoked',
                },
            },
            { headers: NO_STORE },
        );
    } catch (err: unknown) {
        captureException(err, { requestId, context: 'GET /api/credentials/share/[shareToken]' });

        if (err instanceof ContractConfigurationError) {
            await log('chain_unavailable', 500, { errorCategory: 'contract_configuration' });
            return NextResponse.json(
                { success: false, error: 'Server configuration error' },
                { status: 500, headers: NO_STORE },
            );
        }

        if (err instanceof BlockchainUnavailableError) {
            await log('chain_unavailable', 503, { errorCategory: 'contract_read_failed' });
            return NextResponse.json(
                { success: false, error: 'Blockchain verification unavailable' },
                { status: 503, headers: NO_STORE },
            );
        }

        await log('server_error', 500, { errorCategory: 'unexpected_error' });
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500, headers: NO_STORE },
        );
    }
}
