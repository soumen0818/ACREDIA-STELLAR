/**
 * Shared verification result cache — Issue #228.
 *
 * Caches the on-chain credential record (hash, wallets, dates), which never
 * changes once written.
 *
 * Revocation status and issuer authorization can change, so they are stored
 * with a much shorter TTL: a revocation, or an issuer losing authorization,
 * reaches verifiers within its documented window. Expiry is not cached at all;
 * the route re-evaluates it against the clock on every request.
 *
 * The cache is backed by the same Upstash Redis instance used for rate
 * limiting (pure REST — no new npm dependency). If Upstash is not configured
 * or is temporarily unreachable every function returns `null`, which callers
 * treat as a cache miss and fall back to a live chain read.
 */

import { captureException, recordMetric } from './debug';
import type { OnChainCredential } from './contractReads';

// ---------------------------------------------------------------------------
// TTLs
// ---------------------------------------------------------------------------

/** The on-chain credential record is immutable once written. */
const IMMUTABLE_TTL_SECONDS = 4 * 60 * 60; // 4 hours

/** Revocation and issuer authorization can change — keep the stale window short. */
const REVOCATION_TTL_SECONDS = 45;

// ---------------------------------------------------------------------------
// Upstash REST helpers (mirrors the pattern in rateLimit.ts)
// ---------------------------------------------------------------------------

function getUpstashConfig(): { url: string; token: string } | null {
    const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return { url, token };
}

async function redisGet(key: string): Promise<string | null> {
    const cfg = getUpstashConfig();
    if (!cfg) return null;

    try {
        const res = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${cfg.token}` },
            signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { result?: string | null };
        return body.result ?? null;
    } catch (err) {
        captureException(err, { context: 'verificationCache.redisGet', key });
        return null;
    }
}

async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    const cfg = getUpstashConfig();
    if (!cfg) return;

    try {
        await fetch(`${cfg.url}/set/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([value, 'EX', ttlSeconds]),
            signal: AbortSignal.timeout(3_000),
        });
    } catch (err) {
        // Fire-and-forget: a write failure just means a future cache miss.
        captureException(err, { context: 'verificationCache.redisSet', key });
    }
}

// ---------------------------------------------------------------------------
// Cache key builders
// ---------------------------------------------------------------------------

function immutableKey(tokenId: string): string {
    return `verify:immutable:${tokenId}`;
}

function revocationKey(tokenId: string): string {
    return `verify:revoked:${tokenId}`;
}

function issuerKey(issuerAddress: string): string {
    return `verify:issuer:${issuerAddress}`;
}

// ---------------------------------------------------------------------------
// Immutable verification data (the on-chain credential record)
// ---------------------------------------------------------------------------

export interface CachedImmutableData {
    onChain: OnChainCredential;
}

/**
 * Returns the cached immutable verification data for `tokenId`, or `null` on
 * a miss / parse error / Redis unavailability.
 */
export async function getCachedImmutableData(
    tokenId: string,
): Promise<CachedImmutableData | null> {
    const raw = await redisGet(immutableKey(tokenId));
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as CachedImmutableData;
        recordMetric('verification.cache.hit', 1, { kind: 'immutable', tokenId });
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Stores the immutable verification data for `tokenId` with a long TTL.
 * Never throws — a write failure is silently ignored.
 */
export async function setCachedImmutableData(
    tokenId: string,
    data: CachedImmutableData,
): Promise<void> {
    await redisSet(immutableKey(tokenId), JSON.stringify(data), IMMUTABLE_TTL_SECONDS);
    recordMetric('verification.cache.write', 1, { kind: 'immutable', tokenId });
}

// ---------------------------------------------------------------------------
// Revocation status (short TTL — must not serve stale revocations too long)
// ---------------------------------------------------------------------------

/**
 * Returns the cached revocation flag, or `null` if not cached.
 * `null` means: re-fetch from the live source.
 */
export async function getCachedRevocationStatus(
    tokenId: string,
): Promise<boolean | null> {
    const raw = await redisGet(revocationKey(tokenId));
    if (raw === null) return null;

    // Stored as the string "1" (revoked) or "0" (not revoked).
    const value = raw === '1' ? true : raw === '0' ? false : null;
    if (value !== null) {
        recordMetric('verification.cache.hit', 1, { kind: 'revocation', tokenId });
    }
    return value;
}

/**
 * Stores the revocation flag with a short TTL.
 * Never throws.
 */
export async function setCachedRevocationStatus(
    tokenId: string,
    revoked: boolean,
): Promise<void> {
    await redisSet(revocationKey(tokenId), revoked ? '1' : '0', REVOCATION_TTL_SECONDS);
    recordMetric('verification.cache.write', 1, { kind: 'revocation', tokenId });
}

// ---------------------------------------------------------------------------
// Issuer authorization (short TTL — an issuer can be de-authorized)
// ---------------------------------------------------------------------------

/** Returns the cached `is_authorized_issuer` answer, or `null` if not cached. */
export async function getCachedIssuerAuthorization(issuerAddress: string): Promise<boolean | null> {
    const raw = await redisGet(issuerKey(issuerAddress));
    const value = raw === '1' ? true : raw === '0' ? false : null;
    if (value !== null) {
        recordMetric('verification.cache.hit', 1, { kind: 'issuer' });
    }
    return value;
}

/** Stores the `is_authorized_issuer` answer with a short TTL. Never throws. */
export async function setCachedIssuerAuthorization(
    issuerAddress: string,
    authorized: boolean,
): Promise<void> {
    await redisSet(issuerKey(issuerAddress), authorized ? '1' : '0', REVOCATION_TTL_SECONDS);
    recordMetric('verification.cache.write', 1, { kind: 'issuer' });
}

// ---------------------------------------------------------------------------
// Documented TTLs (for HTTP Cache-Control header in the route)
// ---------------------------------------------------------------------------

/** Maximum seconds a CDN/browser may cache a verification response. */
export const RESPONSE_CACHE_MAX_AGE_SECONDS = REVOCATION_TTL_SECONDS;
