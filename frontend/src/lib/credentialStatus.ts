/**
 * A credential's lifecycle status, as the contract's `credential_status`
 * computes it (review §3.11): revocation wins over expiry, and a credential is
 * expired from its `expires_at` second onwards.
 *
 * Kept as a pure function so a cached on-chain record can be re-evaluated on
 * every request: expiry depends on the current time, not on anything cached.
 */
export type CredentialStatus = 'valid' | 'revoked' | 'expired';

export function credentialStatusAt(
    credential: { revoked: boolean; expiresAt: number | null },
    nowSeconds: number,
): CredentialStatus {
    if (credential.revoked) {
        return 'revoked';
    }
    if (credential.expiresAt !== null && nowSeconds >= credential.expiresAt) {
        return 'expired';
    }
    return 'valid';
}

/** Unix seconds to an ISO string, or null. Chain timestamps are seconds. */
export function unixSecondsToIso(seconds: number | null): string | null {
    return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

/**
 * The last day a credential is valid, as a UTC date ("December 31, 2099").
 * Issuers enter a "valid through" date and the contract stores the start of
 * the following UTC day, so this steps back one second before formatting.
 */
export function formatValidThrough(expiresAtIso: string): string {
    const lastValidSecond = new Date(Date.parse(expiresAtIso) - 1000);
    return lastValidSecond.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}
