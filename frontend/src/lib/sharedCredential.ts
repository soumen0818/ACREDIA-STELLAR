import {
    buildCanonicalCredentialPayloadV2,
    CREDENTIAL_HASH_ALGORITHM_V2,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
    deriveCredentialHash,
} from './credentialHash';

/**
 * Share links (review §3.11b): `/credentials/<share_token>`, where the token
 * is the random UUID the database generates for each credential. Only the
 * holder's share link reveals who holds a credential and what it certifies.
 */

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isShareToken(value: string): boolean {
    return SHARE_TOKEN_PATTERN.test(value);
}

/** A credential's public share URL, given the site origin. */
export function shareUrl(origin: string, shareToken: string): string {
    return `${origin}/credentials/${shareToken}`;
}

const DOCUMENT_EVIDENCE_ID = /^urn:sha256:([0-9a-f]{64})$/;

export interface SharedCredentialDetails {
    studentName: string;
    credentialType: string;
    degree: string;
    major: string | null;
    gpa: string | null;
    issueDate: string;
    /** The institution name as the issuer wrote it into the credential. */
    institutionName: string;
    subjects: Array<{
        name: string;
        marks: string;
        maxMarks: string;
        grade: string | null;
    }>;
}

export type VerifiedContent =
    | {
          ok: true;
          details: SharedCredentialDetails;
          /** SHA-256 of the issued document, from the hashed credential; null if none was attached. */
          documentSha256: string | null;
      }
    | {
          ok: false;
          reason: 'unsupported_schema' | 'hash_mismatch' | 'holder_mismatch';
      };

/**
 * Checks a stored credential against its on-chain hash and returns what may
 * be shown. Everything returned comes from the canonical payload, which is
 * exactly what the hash covers: keys outside it, or values the
 * canonicalisation normalises away, could be edited without changing the
 * hash, so the raw stored metadata is never displayed.
 */
export async function verifyStoredCredential(input: {
    metadata: unknown;
    schemaVersion: number | null;
    hashAlgorithm: string | null;
    onChainHash: string;
    onChainStudent: string;
}): Promise<VerifiedContent> {
    // Only the current schema is accepted: every credential issued since the
    // contract redeploy uses it, and each extra schema is another way to
    // read the same hash.
    if (
        input.schemaVersion !== CREDENTIAL_METADATA_SCHEMA_VERSION_V2 ||
        input.hashAlgorithm !== CREDENTIAL_HASH_ALGORITHM_V2
    ) {
        return { ok: false, reason: 'unsupported_schema' };
    }

    const hash = await deriveCredentialHash(input.metadata, input.schemaVersion, input.hashAlgorithm);
    if (hash !== input.onChainHash) {
        return { ok: false, reason: 'hash_mismatch' };
    }

    const payload = buildCanonicalCredentialPayloadV2(input.metadata);
    const data = payload.credentialData;

    // The contract records who holds the credential; the content must name
    // the same wallet, or it describes someone else.
    if (data.studentWallet !== input.onChainStudent) {
        return { ok: false, reason: 'holder_mismatch' };
    }

    const documentEvidence = payload.evidence
        .map((item) => DOCUMENT_EVIDENCE_ID.exec(item.id)?.[1])
        .find((digest): digest is string => Boolean(digest));

    return {
        ok: true,
        details: {
            studentName: data.studentName,
            credentialType: data.credentialType,
            degree: data.degree,
            major: data.major,
            gpa: data.gpa,
            issueDate: data.issueDate,
            institutionName: data.institutionName,
            subjects: data.subjects.map((subject) => ({
                name: subject.name,
                marks: subject.marks,
                maxMarks: subject.maxMarks,
                grade: subject.grade,
            })),
        },
        documentSha256: documentEvidence ?? null,
    };
}
