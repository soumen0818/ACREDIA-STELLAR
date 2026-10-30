import { getContractAddress } from './stellar';
import { shareUrl } from './sharedCredential';
import { runtimeConfig } from './runtimeConfig';
import {
    CREDENTIAL_HASH_ALGORITHM_V1,
    CREDENTIAL_HASH_ALGORITHM_V2,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V1,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
    deriveCredentialHash,
} from './credentialHash';
import {
    attachOnChainAnchor,
    buildAcrediaVerifiableCredential,
    type AcrediaVerifiableCredential,
    type OnChainAnchor,
} from './verifiableCredential';

/**
 * Shape of a `credentials` row (or the curated subset the public `/verify`
 * API returns) needed to produce a standards-compliant export. All fields
 * are optional except `tokenId` because the public-facing caller has less
 * data available than the authenticated student-dashboard caller.
 */
export interface StandardsExportCredentialRow {
    tokenId: string;
    /** The holder's share token; when known, the export links to the share page (review §3.11b). */
    shareToken?: string | null;
    metadata?: unknown;
    metadataSchemaVersion?: number | null;
    hashAlgorithm?: string | null;
    blockchainHash?: string | null;
    /**
     * The credential's actual on-chain hash (hex), when already known from a
     * server-side chain read (e.g. the `/api/verify/[token]` response). When
     * provided, this is trusted over recomputing from `metadata` — useful
     * for the public verify page, which doesn't receive the full metadata
     * blob but does know the real on-chain hash.
     */
    onChainHash?: string | null;
    // Fallback fields used only when `metadata` isn't a V2 VC document
    // (legacy credentials, or the curated public verify response).
    studentName?: string;
    studentWallet?: string;
    institutionName?: string;
    issuerWallet?: string;
    degree?: string;
    credentialType?: string;
    issueDate?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `metadata` already has the shape produced by `buildAcrediaVerifiableCredential`. */
function isVerifiableCredentialDocument(metadata: unknown): metadata is AcrediaVerifiableCredential {
    return (
        isRecord(metadata) &&
        Array.isArray(metadata.type) &&
        (metadata.type as unknown[]).includes('VerifiableCredential') &&
        isRecord(metadata.credentialSubject)
    );
}

function verifyUrl(tokenId: string, shareToken?: string | null): string {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    // The share page proves the details in this export against the chain; a
    // bare token ID can only confirm its status.
    if (shareToken) {
        return shareUrl(origin, shareToken);
    }
    return `${origin}/verify?token=${encodeURIComponent(tokenId)}`;
}

/**
 * Builds the exact standards-compliant document a student/verifier should
 * download for a given credential, enriched with a non-hashed on-chain
 * anchor block.
 *
 * - When the stored metadata is already a schema-v2 VC/OBv3 document (the
 *   default for every credential issued after this feature shipped), the
 *   export is that *exact* stored object — byte-identical to what was
 *   canonically hashed and anchored on-chain — plus the anchor block.
 * - Otherwise (legacy credentials, or the curated public verify response
 *   which doesn't carry the full metadata blob), a best-effort VC/OBv3
 *   document is reconstructed from whatever fields are available. Its
 *   `onChainAnchor.hashCoversThisDocument` is `false`: the reconstruction is
 *   for interoperability/readability, not a byte-exact copy of the anchored
 *   data.
 */
export async function buildStandardsExportDocument(
    row: StandardsExportCredentialRow,
): Promise<AcrediaVerifiableCredential & { credentialStatus: Record<string, unknown>; onChainAnchor: OnChainAnchor }> {
    const network = runtimeConfig.stellar.networkName;
    const contractId = getContractAddress('CREDENTIAL_NFT');
    const explorerBaseUrl = runtimeConfig.stellar.explorerBaseUrl;
    const schemaVersion = row.metadataSchemaVersion ?? null;

    let credential: AcrediaVerifiableCredential;
    let hashCoversThisDocument = false;
    let credentialHash = '';
    let hashAlgorithm = row.hashAlgorithm || 'unknown';

    if (schemaVersion === CREDENTIAL_METADATA_SCHEMA_VERSION_V2 && isVerifiableCredentialDocument(row.metadata)) {
        credential = row.metadata;
        hashAlgorithm = CREDENTIAL_HASH_ALGORITHM_V2;
        credentialHash = await deriveCredentialHash(
            row.metadata,
            CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
            CREDENTIAL_HASH_ALGORITHM_V2,
        );
        hashCoversThisDocument = true;
    } else {
        const legacyData = isRecord(row.metadata) ? isRecord(row.metadata.credentialData) ? row.metadata.credentialData : {} : {};
        credential = buildAcrediaVerifiableCredential(
            {
                studentName: String(legacyData.studentName ?? row.studentName ?? 'Credential Holder'),
                studentWallet: String(legacyData.studentWallet ?? row.studentWallet ?? ''),
                degree: String(legacyData.degree ?? row.degree ?? 'Academic Credential'),
                major: (legacyData.major as string | undefined) ?? undefined,
                gpa: (legacyData.gpa as string | undefined) ?? undefined,
                issueDate: String(legacyData.issueDate ?? row.issueDate ?? new Date().toISOString()),
                credentialType: String(legacyData.credentialType ?? row.credentialType ?? 'credential'),
                institutionName: String(legacyData.institutionName ?? row.institutionName ?? 'Issuing Institution'),
                institutionWallet: String(row.issuerWallet ?? ''),
                subjects: Array.isArray(legacyData.subjects) ? legacyData.subjects : undefined,
            },
            explorerBaseUrl,
            null,
        );

        // A real on-chain hash may still exist for schema-v1 credentials —
        // report it for transparency, but it covers the *original* stored
        // metadata shape, not this reconstructed VC document.
        if (schemaVersion === CREDENTIAL_METADATA_SCHEMA_VERSION_V1 && row.metadata) {
            hashAlgorithm = CREDENTIAL_HASH_ALGORITHM_V1;
            credentialHash = await deriveCredentialHash(
                row.metadata,
                CREDENTIAL_METADATA_SCHEMA_VERSION_V1,
                CREDENTIAL_HASH_ALGORITHM_V1,
            );
        }
    }

    // A caller that already read the chain (e.g. the public /verify API)
    // knows the real on-chain hash even when the full metadata blob wasn't
    // sent to build/recompute it from. Trust that value when present.
    if (row.onChainHash) {
        credentialHash = row.onChainHash;
        if (row.hashAlgorithm) {
            hashAlgorithm = row.hashAlgorithm;
        }
    }

    const anchor: OnChainAnchor = {
        network,
        contractId,
        tokenId: row.tokenId,
        transactionHash: row.blockchainHash || '',
        credentialHash,
        hashAlgorithm,
        canonicalizationAlgorithm: 'sha256:canonical-json (see docs/verifiable-credentials.md)',
        verifyUrl: verifyUrl(row.tokenId, row.shareToken),
        hashCoversThisDocument,
    };

    return attachOnChainAnchor(credential, anchor);
}

export function getLinkedInShareUrl(credential: {
    title: string;
    institutionName: string;
    issueDate?: string;
    tokenId: string;
    certUrl: string;
}): string {
    const issueDateObj = credential.issueDate ? new Date(credential.issueDate) : new Date();
    const issueYear = issueDateObj.getFullYear();
    const issueMonth = issueDateObj.getMonth() + 1;

    const params = new URLSearchParams({
        startTask: 'CERTIFICATION_NAME',
        name: credential.title || 'Academic Credential',
        organizationName: credential.institutionName || 'Acredia Institution',
        issueYear: String(issueYear),
        issueMonth: String(issueMonth),
        certUrl: credential.certUrl,
        certId: credential.tokenId,
    });

    return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export function downloadJsonFile(data: object, filename: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
