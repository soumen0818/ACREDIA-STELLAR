import type { CredentialStatusRecord } from '@/hooks/useCredentialVerification';
import { parseVerificationResponse } from '@/hooks/useCredentialVerification';
import type { PublicCredentialCardData } from '@/components/student/PublicCredentialCard';
import type { SharedCredentialDetails } from './sharedCredential';

export interface SharedCredentialView {
    /** The on-chain status, shown whether or not the content verified. */
    status: CredentialStatusRecord;
    /** Present only when the content was proven against the on-chain hash. */
    card: PublicCredentialCardData | null;
}

type Payload = {
    credential?: Record<string, unknown>;
    verification?: Record<string, unknown>;
};

function text(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

/**
 * Maps `/api/credentials/share/:shareToken` to the share page (review
 * §3.11b). Fails closed like the status check: an unrecognised status
 * throws, and the details card is only built when the API says the content
 * matched the chain and actually sent it.
 */
export function parseShareResponse(shareToken: string, payload: Payload): SharedCredentialView {
    const status = parseVerificationResponse(payload);
    const credential = payload.credential ?? {};
    const details = credential.details as SharedCredentialDetails | null | undefined;
    const contentMatches = payload.verification?.contentMatches === true;

    if (!contentMatches || !details) {
        return { status, card: null };
    }

    const document = credential.document as { url?: unknown; sha256?: unknown } | null | undefined;
    const documentUrl = text(document?.url);
    const documentSha256 = text(document?.sha256);
    const documentStatus = credential.documentStatus;

    return {
        status,
        card: {
            shareToken,
            tokenId: status.token_id,
            status: status.status,
            issuedAt: status.issued_at,
            expiresAt: status.expires_at,
            revocationSource: status.revocation_source,
            institutionName: status.institution_name ?? details.institutionName,
            issuerWallet: status.issuer_wallet_address ?? '',
            studentWallet: text(credential.studentWallet) ?? '',
            onChainHash: status.on_chain_hash ?? '',
            transactionHash: text(credential.transactionHash),
            details,
            metadata: credential.metadata ?? null,
            metadataSchemaVersion:
                typeof credential.metadataSchemaVersion === 'number' ? credential.metadataSchemaVersion : null,
            hashAlgorithm: text(credential.hashAlgorithm),
            document: documentUrl && documentSha256 ? { url: documentUrl, sha256: documentSha256 } : null,
            documentStatus:
                documentStatus === 'available' || documentStatus === 'unavailable' ? documentStatus : 'none',
        },
    };
}
