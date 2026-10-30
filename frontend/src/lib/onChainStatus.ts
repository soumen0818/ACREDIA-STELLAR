import {
    getCredentialFromChain,
    isAuthorizedIssuerOnChain,
    isRevokedFromChain,
    type OnChainCredential,
} from './contractReads';
import { credentialStatusAt, type CredentialStatus } from './credentialStatus';
import {
    getCachedImmutableData,
    getCachedIssuerAuthorization,
    getCachedRevocationStatus,
    setCachedImmutableData,
    setCachedIssuerAuthorization,
    setCachedRevocationStatus,
} from './verificationCache';

export interface OnChainStatus {
    onChain: OnChainCredential;
    status: CredentialStatus;
    revoked: boolean;
    issuerAuthorized: boolean;
    cache: { immutableHit: boolean; revocationHit: boolean };
}

/**
 * A credential's status, read from the contract (review §3.11b), or null when
 * the contract has no such token. Shared by the token-ID check and the share
 * page so both answer identically.
 *
 * Cache layer — Issue #228: the on-chain record is immutable, so it is cached
 * with a long TTL. Revocation and issuer authorization use a short TTL so a
 * change reaches verifiers within its documented window. Expiry is evaluated
 * against the clock on every call, and the `revoked` flag inside a cached
 * record is never trusted. Chain read failures propagate: the caller must
 * not guess a status during an outage.
 */
export async function readOnChainStatus(tokenId: string): Promise<OnChainStatus | null> {
    const cachedImmutable = await getCachedImmutableData(tokenId);
    const onChain = cachedImmutable?.onChain ?? (await getCredentialFromChain(tokenId));

    if (!onChain) {
        return null;
    }

    if (!cachedImmutable) {
        // Write in the background — don't block the response.
        void setCachedImmutableData(tokenId, { onChain });
    }

    let revoked = await getCachedRevocationStatus(tokenId);
    const revocationHit = revoked !== null;
    if (revoked === null) {
        revoked = await isRevokedFromChain(tokenId);
        void setCachedRevocationStatus(tokenId, revoked);
    }

    let issuerAuthorized = await getCachedIssuerAuthorization(onChain.issuer);
    if (issuerAuthorized === null) {
        issuerAuthorized = await isAuthorizedIssuerOnChain(onChain.issuer);
        void setCachedIssuerAuthorization(onChain.issuer, issuerAuthorized);
    }

    return {
        onChain,
        status: credentialStatusAt(
            { revoked, expiresAt: onChain.expiresAt },
            Math.floor(Date.now() / 1000),
        ),
        revoked,
        issuerAuthorized,
        cache: { immutableHit: cachedImmutable !== null, revocationHit },
    };
}
