/**
 * Builds Acredia credential metadata as a W3C Verifiable Credential (VC Data
 * Model 1.1) that also conforms to the 1EdTech Open Badges 3.0
 * `OpenBadgeCredential` profile.
 *
 * This is the single source of truth for the document shape: the exact
 * object built here is what is stored privately and canonically hashed
 * on-chain at issuance time (see `credentialService.ts` and
 * `buildCanonicalCredentialPayloadV2` in `credentialHash.ts`), and it is also
 * what the student-dashboard/public "download standards-compliant credential"
 * export re-serves later. Keeping one builder means the exported file is
 * always byte-identical to what was hashed, never a lossy re-derivation.
 *
 * Design notes:
 *  - `@context` pins the real, versioned W3C VC 1.1 and 1EdTech OBv3 contexts,
 *    plus a small local vocabulary (`acredia:`) for the two extension
 *    properties this app adds: `credentialData` (legacy-shaped fields kept
 *    for backward-compatible internal display/search) and `onChainAnchor`
 *    (attached only to *exported* copies, never part of the hashed core —
 *    see `attachOnChainAnchor`).
 *  - Subject/issuer `id`s are real, resolvable `https://` Stellar Expert
 *    account URLs rather than an invented, unregistered DID method — a
 *    generic VC/OBv3 consumer can actually open them.
 *  - No `proof` block is embedded in the hashed core: this system's proof of
 *    issuance is the Stellar on-chain transaction + anchored hash, not an
 *    embedded Data Integrity signature. See docs/verifiable-credentials.md
 *    for the verification recipe.
 */

export interface VerifiableCredentialSubject {
    id: string;
    name: string;
    marks: string;
    maxMarks: string;
    grade?: string;
}

export interface BuildVerifiableCredentialInput {
    studentName: string;
    studentWallet: string;
    degree: string;
    major?: string;
    gpa?: string;
    issueDate: string;
    credentialType: string;
    institutionName: string;
    institutionWallet: string;
    subjects?: VerifiableCredentialSubject[];
}

export interface AchievementResult {
    type: string[];
    resultDescription: string;
    value: string;
}

export interface AcrediaAchievement {
    id: string;
    type: string[];
    name: string;
    description: string;
    achievementType: string | null;
    criteria: { narrative: string };
}

export interface AcrediaCredentialSubject {
    id: string;
    type: string[];
    name: string;
    achievement: AcrediaAchievement;
    result: AchievementResult[];
}

export interface AcrediaEvidence {
    id: string;
    type: string[];
    name: string;
    description: string;
}

export interface AcrediaVerifiableCredential {
    '@context': (string | Record<string, unknown>)[];
    id: string;
    type: string[];
    name: string;
    description: string;
    image: string | null;
    issuer: {
        id: string;
        type: string[];
        name: string;
    };
    issuanceDate: string;
    credentialSubject: AcrediaCredentialSubject;
    evidence: AcrediaEvidence[];
    /** Legacy NFT-style fields, kept so existing dashboards/search continue to work unmodified. Not a VC/OBv3 standard property. */
    credentialData: {
        studentName: string;
        studentWallet: string;
        degree: string;
        major?: string;
        gpa?: string;
        issueDate: string;
        institutionName: string;
        credentialType: string;
        subjects?: VerifiableCredentialSubject[];
    };
}

export const VC_CONTEXT_V1 = 'https://www.w3.org/2018/credentials/v1';
export const OBV3_CONTEXT = 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json';
export const ACREDIA_VOCAB_CONTEXT = {
    acredia: 'https://acredia.app/ns#',
    credentialData: 'acredia:credentialData',
    onChainAnchor: 'acredia:onChainAnchor',
};

const ACHIEVEMENT_TYPE_BY_CREDENTIAL_TYPE: Record<string, string> = {
    diploma: 'Diploma',
    degree: 'Degree',
    transcript: 'Transcript',
    certificate: 'Certificate',
    achievement: 'Achievement',
};

function slugify(value: string): string {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'na'
    );
}

function mintUuid(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    // Fallback RFC 4122 v4 generator for environments without crypto.randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = (Math.random() * 16) | 0;
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function toIsoDateTime(issueDate: string): string {
    const date = new Date(issueDate);
    if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
    }

    return new Date().toISOString();
}

function accountUrl(explorerBaseUrl: string, wallet: string): string {
    return `${explorerBaseUrl}/account/${wallet}`;
}

/**
 * Builds the W3C VC / OBv3 credential document for a newly-issued credential.
 *
 * @param data Form/issuance data for this credential.
 * @param explorerBaseUrl Stellar Expert explorer base URL for the active
 *   network (e.g. `runtimeConfig.stellar.explorerBaseUrl`), used to build
 *   resolvable `issuer.id` / `credentialSubject.id` URIs.
 * @param evidence The source document (transcript/diploma scan), if any.
 *   For an uploaded document, `id` is `urn:sha256:<hex>` (see
 *   `documentEvidenceId`): the document is stored privately and its digest,
 *   which the on-chain hash covers, is what identifies it here. CSV-issued
 *   credentials may instead reference the institution's own URL.
 */
export function buildAcrediaVerifiableCredential(
    data: BuildVerifiableCredentialInput,
    explorerBaseUrl: string,
    evidence?: { id: string; description: string } | null,
): AcrediaVerifiableCredential {
    const achievementType = ACHIEVEMENT_TYPE_BY_CREDENTIAL_TYPE[data.credentialType] ?? 'Achievement';
    const achievementId = `urn:acredia:achievement:${slugify(data.institutionWallet)}:${slugify(
        data.credentialType,
    )}:${slugify(data.degree)}`;

    const result: AchievementResult[] = [];
    if (data.gpa) {
        result.push({
            type: ['Result'],
            resultDescription: 'GPA',
            value: data.gpa,
        });
    }

    const evidenceItems: AcrediaEvidence[] = evidence
        ? [
              {
                  id: evidence.id,
                  type: ['Evidence'],
                  name: 'Original credential document',
                  description: evidence.description,
              },
          ]
        : [];

    return {
        '@context': [VC_CONTEXT_V1, OBV3_CONTEXT, ACREDIA_VOCAB_CONTEXT],
        id: `urn:uuid:${mintUuid()}`,
        type: ['VerifiableCredential', 'OpenBadgeCredential'],
        name: `${data.credentialType} - ${data.studentName}`,
        description: `Academic credential issued by ${data.institutionName} to ${data.studentName}`,
        // Never a document link: the document is private (review §3.11).
        image: null,
        issuer: {
            id: accountUrl(explorerBaseUrl, data.institutionWallet),
            type: ['Profile'],
            name: data.institutionName,
        },
        issuanceDate: toIsoDateTime(data.issueDate),
        credentialSubject: {
            id: accountUrl(explorerBaseUrl, data.studentWallet),
            type: ['AchievementSubject'],
            name: data.studentName,
            achievement: {
                id: achievementId,
                type: ['Achievement'],
                name: data.degree,
                description: `Academic ${data.credentialType} verified on the Stellar blockchain.`,
                achievementType,
                criteria: {
                    narrative:
                        'Issued upon successful completion and verification of the stated academic requirements.',
                },
            },
            result,
        },
        evidence: evidenceItems,
        credentialData: {
            studentName: data.studentName,
            studentWallet: data.studentWallet,
            degree: data.degree,
            major: data.major,
            gpa: data.gpa,
            issueDate: data.issueDate,
            institutionName: data.institutionName,
            credentialType: data.credentialType,
            subjects: data.subjects,
        },
    };
}

export interface OnChainAnchor {
    network: string;
    contractId: string;
    tokenId: string;
    transactionHash: string;
    credentialHash: string;
    hashAlgorithm: string;
    canonicalizationAlgorithm: string;
    verifyUrl: string;
    /**
     * True only when `credentialHash` is the hash of exactly *this* exported
     * document's core fields (schema v2). Older credentials issued before
     * this format was byte-for-byte anchored on the VC form (schema v1) can
     * still report their real on-chain hash here, but it covers the legacy
     * metadata shape, not this reconstructed VC — set to `false` in that
     * case so downstream consumers don't assume a hash match that doesn't
     * hold. See docs/verifiable-credentials.md.
     */
    hashCoversThisDocument: boolean;
}

/**
 * Attaches a non-hashed `credentialStatus` + `onChainAnchor` block to a copy
 * of the credential for download/export. This is deliberately never part of
 * the hashed core (see `buildCanonicalCredentialPayloadV2`): a verifier
 * checks authenticity by stripping these two properties, canonicalizing the
 * rest, and comparing the resulting hash to `onChainAnchor.credentialHash`
 * (which itself should match what is stored on-chain for the token).
 */
export function attachOnChainAnchor(
    credential: AcrediaVerifiableCredential,
    anchor: OnChainAnchor,
): AcrediaVerifiableCredential & {
    credentialStatus: Record<string, unknown>;
    onChainAnchor: OnChainAnchor;
} {
    return {
        ...credential,
        credentialStatus: {
            id: anchor.verifyUrl,
            type: 'StellarSorobanRevocationStatus2024',
            stellarNetwork: anchor.network,
            stellarContractId: anchor.contractId,
            stellarTokenId: anchor.tokenId,
        },
        onChainAnchor: anchor,
    };
}
