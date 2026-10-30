/**
 * Credential documents (diploma scans, transcripts) live in a private
 * Storage bucket, never on public IPFS (review §3.11). Shared by the upload
 * route and the issuance form so both apply the same rules.
 */

/** Private bucket; see 20261030000000_private_credential_documents.sql. */
export const CREDENTIAL_DOCUMENTS_BUCKET = 'credential-documents';

export const MAX_CREDENTIAL_DOCUMENT_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
};

export function credentialDocumentExtension(mediaType: string): string | null {
    return EXTENSION_BY_TYPE[mediaType] ?? null;
}

/** Returns a user-facing error, or null when the file is acceptable. */
export function validateCredentialDocument(file: { type: string; size: number }): string | null {
    if (!credentialDocumentExtension(file.type)) {
        return 'Invalid file type. Please upload PDF, JPG, or PNG files only.';
    }
    if (file.size === 0) {
        return 'The file is empty.';
    }
    if (file.size > MAX_CREDENTIAL_DOCUMENT_BYTES) {
        return 'File size must be less than 10MB.';
    }
    return null;
}

/** Lowercase hex SHA-256, as stored in credentials.document_sha256. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
    );
}

/**
 * The evidence id recorded in the credential JSON for an uploaded document.
 * The on-chain hash covers evidence ids, so this anchors the document itself.
 */
export function documentEvidenceId(sha256: string): string {
    return `urn:sha256:${sha256}`;
}
