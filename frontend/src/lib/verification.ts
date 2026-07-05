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
