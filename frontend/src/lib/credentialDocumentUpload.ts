import { captureException } from './debug';
import { getE2eState } from './e2e';
import { sha256Hex } from './credentialDocuments';
import { supabase, safeGetSession } from './supabase';

const DOCUMENT_ROUTE = '/api/institution/documents';
const EXPIRED_TOKEN_ERROR = 'Invalid or expired access token';

export interface StoredCredentialDocument {
    /** Object path in the private credential-documents bucket. */
    path: string;
    /** Lowercase hex SHA-256 of the file. */
    sha256: string;
}

async function getAccessToken(): Promise<string> {
    const { data } = await safeGetSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
        throw new Error('You must be signed in as an institution to upload documents.');
    }
    return accessToken;
}

function postDocument(file: File, accessToken: string): Promise<Response> {
    // Rebuilt per attempt: a FormData body is consumed by the first fetch.
    const formData = new FormData();
    formData.append('file', file, file.name);
    return fetch(DOCUMENT_ROUTE, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
    });
}

/**
 * Stores a credential document privately (review §3.11) and returns its path
 * and SHA-256. A single retry covers a session token that expired mid-flight.
 */
export async function uploadCredentialDocument(file: File): Promise<StoredCredentialDocument> {
    if (getE2eState()?.enabled) {
        return {
            path: `e2e/${file.name.replace(/[^a-z0-9.]+/gi, '-').toLowerCase()}`,
            sha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())),
        };
    }

    try {
        let response = await postDocument(file, await getAccessToken());

        if (response.status === 401) {
            const payload = await response
                .clone()
                .json()
                .catch(() => null);
            if (payload?.error === EXPIRED_TOKEN_ERROR) {
                const { data: refreshed, error } = await supabase.auth.refreshSession();
                const token = refreshed.session?.access_token;
                if (error || !token) {
                    throw new Error('Your session expired. Please sign in again.');
                }
                response = await postDocument(file, token);
            }
        }

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !payload.path || !payload.sha256) {
            throw new Error(payload?.error || 'Document upload failed');
        }

        return { path: payload.path as string, sha256: payload.sha256 as string };
    } catch (error: unknown) {
        captureException(error, { context: 'uploadCredentialDocument' });
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to store the document: ${message}`, { cause: error });
    }
}
