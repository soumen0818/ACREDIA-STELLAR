import { NextResponse } from 'next/server';
import { captureException } from './debug';

// ---------------------------------------------------------------------------
// Limiter mode — Issue #229
// ---------------------------------------------------------------------------

/**
 * Three distinct states that callers and health checks can act on:
 *
 *   distributed          – Upstash is configured and reachable; limits are
 *                          shared across all serverless instances.
 *   in-memory-fallback   – Upstash is configured but temporarily unreachable;
 *                          per-instance fallback is active for this invocation.
 *   in-memory-unconfigured – UPSTASH_REDIS_* env vars were never set; the
 *                          deployment is always per-instance (security gap in
 *                          production).
 */
export type RateLimiterMode =
    | 'distributed'
    | 'in-memory-fallback'
    | 'in-memory-unconfigured';

/** Current limiter backend mode for this serverless instance. */
let currentMode: RateLimiterMode = 'in-memory-unconfigured';

/** Returns the active limiter mode. Safe to call from any server context. */
export function getRateLimiterMode(): RateLimiterMode {
    return currentMode;
}

type RateLimitOptions = {
    windowSeconds: number;
    maxRequests: number;
    prefix?: string;
    /**
     * Bucket the limit on this value instead of the client IP. Use for
     * per-user quotas on authenticated routes, where a single account must not
     * be able to sidestep its quota by rotating source addresses.
     */
    identifier?: string;
};

type RateLimitResult = {
    success: boolean;
    remaining: number;
    retryAfter: number;
};

export type RateLimitBucket = { count: number; resetAt: number };

export type RateLimitStore = {
    increment: (key: string, windowSeconds: number) => Promise<{ count: number; resetAt: number }>;
    reset?: () => void;
};

const fixedBuckets = new Map<string, RateLimitBucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

export const getClientIp = (request: Request): string => {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        const [firstIp] = forwardedFor.split(',');
        if (firstIp?.trim()) {
            return firstIp.trim();
        }
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp?.trim()) {
        return realIp.trim();
    }

    const requestWithIp = request as Request & { ip?: string | null };
    if (requestWithIp.ip?.trim()) {
        return requestWithIp.ip.trim();
    }

    return 'unknown';
};

function cleanupStaleBuckets(now: number, store = fixedBuckets) {
    for (const [key, bucket] of store.entries()) {
        if (bucket.resetAt <= now) {
            store.delete(key);
        }
    }
    lastCleanup = now;
}

export function createInMemoryRateLimitStore(
    store: Map<string, RateLimitBucket> = new Map(),
): RateLimitStore {
    return {
        async increment(key: string, windowSeconds: number) {
            const now = Date.now();
            if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
                cleanupStaleBuckets(now, store);
            }

            const existing = store.get(key);
            if (!existing || existing.resetAt <= now) {
                const bucket = { count: 1, resetAt: now + windowSeconds * 1000 };
                store.set(key, bucket);
                return bucket;
            }

            existing.count += 1;
            store.set(key, existing);
            return existing;
        },
        reset() {
            store.clear();
            lastCleanup = Date.now();
        },
    };
}

export function createUpstashRateLimitStore(): RateLimitStore | null {
    const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;

    // Capture at store-creation time so a later env mutation cannot change which
    // endpoint is in use for this store instance.
    const restUrl = url;
    const restToken = token;

    // Fallback in-memory store used transparently when Redis is temporarily
    // unreachable so individual requests are never outright dropped due to an
    // infrastructure hiccup.
    const fallback = createInMemoryRateLimitStore();

    return {
        async increment(key: string, windowSeconds: number) {
            try {
                const response = await fetch(`${restUrl}/pipeline`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${restToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify([
                        ['INCR', key],
                        ['EXPIRE', key, windowSeconds, 'NX'],
                        ['TTL', key],
                    ]),
                });

                if (!response.ok) {
                    throw new Error(`Upstash responded ${response.status}`);
                }

                const [countResult, , ttlResult] = await response.json() as Array<{ result?: unknown }>;
                const count = Number(countResult?.result ?? 1);
                const ttl = Number(ttlResult?.result ?? windowSeconds);

                // Upstash is reachable — mark limiter as distributed.
                currentMode = 'distributed';

                return {
                    count,
                    resetAt: Date.now() + Math.max(1, ttl) * 1000,
                };
            } catch (err) {
                // Degrade gracefully: log and fall back to per-instance memory store.
                // This means limits may not be globally enforced during an outage, but
                // legitimate traffic is never blocked by a Redis error.
                // Mark as fallback so health checks and admin console can surface this.
                currentMode = 'in-memory-fallback';
                captureException(err, { context: 'rateLimit.increment', fallback: 'in-memory' });
                return fallback.increment(key, windowSeconds);
            }
        },
        // Flush all rate-limit keys in the configured Upstash database.
        // Uses SCAN + DEL to avoid blocking the server with a FLUSHDB.
        // Intended for test harnesses and ops tooling — not for production hot paths.
        async reset() {
            try {
                let cursor = '0';
                const keysToDelete: string[] = [];

                do {
                    const scanResponse = await fetch(`${restUrl}/pipeline`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${restToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify([['SCAN', cursor, 'MATCH', '*', 'COUNT', '100']]),
                    });

                    if (!scanResponse.ok) break;

                    const [scanResult] = await scanResponse.json() as Array<{ result?: [string, string[]] }>;
                    const [nextCursor, keys] = scanResult?.result ?? ['0', []];
                    cursor = nextCursor;
                    keysToDelete.push(...keys);
                } while (cursor !== '0');

                if (keysToDelete.length > 0) {
                    await fetch(`${restUrl}/pipeline`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${restToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(keysToDelete.map((k) => ['DEL', k])),
                    });
                }

                // Also flush the local fallback store
                fallback.reset?.();
            } catch (err) {
                captureException(err, { context: 'rateLimit.reset' });
                fallback.reset?.();
            }
        },
    };
}

function initRateLimitStore(): RateLimitStore {
    const upstashStore = createUpstashRateLimitStore();
    if (upstashStore) {
        // Upstash is configured — mode will be updated to 'distributed' on
        // the first successful round-trip (inside increment). Until then,
        // leave currentMode as 'in-memory-unconfigured' so health checks
        // conservatively report the worst state.
        return upstashStore;
    }

    // UPSTASH_REDIS_* env vars are absent — per-instance memory only.
    currentMode = 'in-memory-unconfigured';

    if (process.env.NODE_ENV === 'production') {
        // Emit once per cold start. This will appear in Vercel Function logs
        // and any observability pipeline, making the misconfiguration visible.
        // eslint-disable-next-line no-console -- deliberate: this misconfiguration must be visible in Vercel Function logs at cold start, which is the only place it surfaces.
        console.warn(
            '[rate-limit] WARNING: Distributed rate limiting is NOT configured. ' +
            'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are missing. ' +
            'Rate limiting is per-instance (in-memory) only — limits are not ' +
            'shared across serverless instances and reset on every cold start. ' +
            'Set the Upstash variables in your deployment environment to enable ' +
            'global distributed rate limiting.',
        );
    }

    return createInMemoryRateLimitStore(fixedBuckets);
}

let activeStore: RateLimitStore = initRateLimitStore();

/**
 * Re-read the Upstash environment variables and replace the active store.
 * Useful when env vars are injected after module load (e.g., in test bootstraps).
 */
export function reinitRateLimitStore(): void {
    activeStore = initRateLimitStore();
}

function readEnvOverride(prefix: string | undefined, name: 'WINDOW_SECONDS' | 'MAX_REQUESTS'): number | null {
    if (!prefix) return null;
    const envName = `RATE_LIMIT_${prefix.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_${name}`;
    const raw = process.env[envName];
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const setRateLimitStoreForTests = (store: RateLimitStore) => {
    activeStore = store;
};

export const checkRateLimit = async (
    request: Request,
    { windowSeconds, maxRequests, prefix = 'api', identifier }: RateLimitOptions,
): Promise<RateLimitResult> => {
    const effectiveWindowSeconds = readEnvOverride(prefix, 'WINDOW_SECONDS') ?? windowSeconds;
    const effectiveMaxRequests = readEnvOverride(prefix, 'MAX_REQUESTS') ?? maxRequests;
    const subject = identifier?.trim() || getClientIp(request);
    const key = `${prefix}:${subject}`;
    const bucket = await activeStore.increment(key, effectiveWindowSeconds);

    if (bucket.count > effectiveMaxRequests) {
        return {
            success: false,
            remaining: 0,
            retryAfter: Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)),
        };
    }

    return {
        success: true,
        remaining: Math.max(0, effectiveMaxRequests - bucket.count),
        retryAfter: 0,
    };
};

export const enforceRateLimit = async (
    request: Request,
    options: RateLimitOptions,
): Promise<NextResponse | null> => {
    const result = await checkRateLimit(request, options);

    if (result.success) {
        return null;
    }

    return NextResponse.json(
        { success: false, error: 'Too many requests' },
        {
            status: 429,
            headers: {
                'Retry-After': String(result.retryAfter),
            },
        },
    );
};

export const resetRateLimitStore = () => {
    activeStore.reset?.();
};
