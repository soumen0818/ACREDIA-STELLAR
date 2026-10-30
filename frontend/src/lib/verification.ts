import { isShareToken } from './sharedCredential';

export function extractTokenFromQrPayload(payload: string) {
    const value = payload.trim();

    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);
        const tokenFromQuery = url.searchParams.get('token');

        if (tokenFromQuery?.trim()) {
            return tokenFromQuery.trim();
        }
    } catch {
        // Non-URL QR values are treated as raw token IDs below.
    }

    if (/^[A-Za-z0-9._:-]+$/.test(value)) {
        return value;
    }

    return null;
}

export type VerificationTarget =
    | { kind: 'token'; tokenId: string }
    | { kind: 'share'; shareToken: string };

const SHARE_PATH = /^\/credentials\/([^/]+)\/?$/;

/**
 * What a scanned QR code or pasted value points at (review §3.11b): a
 * holder's share link (`/credentials/<share_token>`, or the bare token),
 * which opens the share page, or a token ID for a status check.
 */
export function parseVerificationInput(payload: string): VerificationTarget | null {
    const value = payload.trim();

    try {
        const sharePath = SHARE_PATH.exec(new URL(value).pathname)?.[1];
        if (sharePath && isShareToken(sharePath)) {
            return { kind: 'share', shareToken: sharePath.toLowerCase() };
        }
        // Old showcase links used the token ID; they now show status only.
        if (sharePath && /^\d+$/.test(sharePath)) {
            return { kind: 'token', tokenId: sharePath };
        }
    } catch {
        // Not a URL; handled below.
    }

    if (isShareToken(value)) {
        return { kind: 'share', shareToken: value.toLowerCase() };
    }

    const tokenId = extractTokenFromQrPayload(value);
    return tokenId ? { kind: 'token', tokenId } : null;
}
