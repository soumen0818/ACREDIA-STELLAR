import { safeGetSession } from './supabase';

/**
 * Fetches a short-lived signed URL for a credential's private document, for
 * its holder or issuing institution (review §3.11b). Others use the share link.
 */
export async function getCredentialDocumentUrl(credentialId: string): Promise<string> {
    const {
        data: { session },
    } = await safeGetSession();
    if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again.');
    }

    const response = await fetch(`/api/credentials/${encodeURIComponent(credentialId)}/document`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || typeof payload.url !== 'string') {
        throw new Error(payload?.error || 'Failed to load the document.');
    }
    return payload.url;
}
