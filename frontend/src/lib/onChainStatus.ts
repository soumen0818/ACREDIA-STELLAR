import {
    BlockchainUnavailableError,
    getCredentialFromChain,
    isAuthorizedIssuerOnChain,
    isRevokedFromChain,
    type OnChainCredential,
} from './contractReads';
import { credentialStatusAt, type CredentialStatus } from './credentialStatus';
import { captureException, recordMetric } from './debug';
import {
    getCachedImmutableData,
    getCachedIssuerAuthorization,
    getCachedRevocationStatus,
    getLastKnownVerification,
    REVOCATION_TTL_SECONDS,
    setCachedImmutableData,
    setCachedIssuerAuthorization,
    setCachedRevocationStatus,
    setLastKnownVerification,
} from './verificationCache';

/** How current an answer is (issue #313). */
export interface AnswerFreshness {
    /**
     * True when the chain could not be read and this is the last known
     * answer. Never true for a "not found": that is only ever said live.
     */
    stale: boolean;
    /**
     * When the answer was last confirmed from the chain (ISO 8601). For a
     * live answer built partly from the short-TTL cache this is up to
     * REVOCATION_TTL_SECONDS old, and never later than the truth.
     */
    checkedAt: string;
    /**
     * Whether the credential may have been revoked since `checkedAt`. Only a
     * stale answer for an unrevoked credential: revocation is permanent, so a
     * credential last seen revoked is still revoked.
     */
    revocationMayBeOutdated: boolean;
    /** Whether the issuer's authorization may have changed since `checkedAt`. */
    issuerAuthorizationMayBeOutdated: boolean;
}

/**
 * The freshness fields of a verification response's `verification` object,
 * identical on the token-ID check and the share link.
 */
export function freshnessFields(freshness: AnswerFreshness) {
    return {
        stale: freshness.stale,
        checkedAt: freshness.checkedAt,
        revocationStatusMayBeOutdated: freshness.revocationMayBeOutdated,
        issuerStatusMayBeOutdated: freshness.issuerAuthorizationMayBeOutdated,
    };
}

export interface OnChainStatus {
    onChain: OnChainCredential;
    status: CredentialStatus;
    revoked: boolean;
    issuerAuthorized: boolean;
    cache: { immutableHit: boolean; revocationHit: boolean };
    freshness: AnswerFreshness;
}

/** The credential as last read live, or null when the contract has no such token. */
async function readLive(tokenId: string, nowMs: number): Promise<OnChainStatus | null> {
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
    const issuerHit = issuerAuthorized !== null;
    if (issuerAuthorized === null) {
        issuerAuthorized = await isAuthorizedIssuerOnChain(onChain.issuer);
        void setCachedIssuerAuthorization(onChain.issuer, issuerAuthorized);
    }

    // A cached value was read from the chain at most one TTL ago; counting it
    // as exactly that old can only understate how fresh the answer is.
    const confirmedAt = (hit: boolean) => (hit ? nowMs - REVOCATION_TTL_SECONDS * 1000 : nowMs);
    const checkedAt = Math.min(confirmedAt(revocationHit), confirmedAt(issuerHit));

    // Kept for outages. Only when something was read live: otherwise the
    // record was already written when those cache entries were filled.
    // Best effort: a failed write must never fail the verification itself.
    if (!revocationHit || !issuerHit) {
        void Promise.resolve()
            .then(() => setLastKnownVerification(tokenId, { onChain, revoked, issuerAuthorized, checkedAt }))
            .catch((error) => captureException(error, { context: 'readOnChainStatus: last known write', tokenId }));
    }

    return {
        onChain,
        status: credentialStatusAt({ revoked, expiresAt: onChain.expiresAt }, Math.floor(nowMs / 1000)),
        revoked,
        issuerAuthorized,
        cache: { immutableHit: cachedImmutable !== null, revocationHit },
        freshness: {
            stale: false,
            checkedAt: new Date(checkedAt).toISOString(),
            revocationMayBeOutdated: false,
            issuerAuthorizationMayBeOutdated: false,
        },
    };
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
 * record is never trusted.
 *
 * Outages — Issue #313: when the chain cannot be read on any RPC endpoint,
 * the last known answer is returned instead, marked `stale` with the time it
 * was confirmed. Without one, `BlockchainUnavailableError` propagates: the
 * caller must not guess a status. The rule this keeps: "we cannot check right
 * now" is never shown as invalid, and never as valid without its age.
 */
export async function readOnChainStatus(tokenId: string): Promise<OnChainStatus | null> {
    const nowMs = Date.now();
    try {
        return await readLive(tokenId, nowMs);
    } catch (error) {
        // Only an outage. A configuration error, or anything unexpected, is
        // not something an old answer should paper over.
        if (!(error instanceof BlockchainUnavailableError)) throw error;

        const lastKnown = await getLastKnownVerification(tokenId).catch(() => null);
        if (!lastKnown) throw error;

        captureException(error, { context: 'readOnChainStatus: served last known answer', tokenId });
        recordMetric('verification.stale_served', 1, {
            tokenId,
            ageSeconds: Math.max(0, Math.round((nowMs - lastKnown.checkedAt) / 1000)),
        });

        const { onChain, revoked, issuerAuthorized, checkedAt } = lastKnown;
        return {
            onChain,
            // Expiry is the clock's, not the cache's, so it is evaluated now.
            status: credentialStatusAt({ revoked, expiresAt: onChain.expiresAt }, Math.floor(nowMs / 1000)),
            revoked,
            issuerAuthorized,
            cache: { immutableHit: false, revocationHit: false },
            freshness: {
                stale: true,
                checkedAt: new Date(checkedAt).toISOString(),
                revocationMayBeOutdated: !revoked,
                issuerAuthorizationMayBeOutdated: true,
            },
        };
    }
}
