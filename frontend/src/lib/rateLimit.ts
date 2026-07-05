import { NextResponse } from 'next/server';

type RateLimitOptions = {
    windowSeconds: number;
    maxRequests: number;
    prefix?: string;
};

type RateLimitResult = {
    success: boolean;
    remaining: number;
    retryAfter: number;
};

const buckets = new Map<string, number[]>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
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

function cleanupStaleBuckets(now: number) {
    for (const [key, timestamps] of buckets.entries()) {
        // Remove entries with no activity in the last 10 minutes
        const active = timestamps.filter((ts) => now - ts < 10 * 60 * 1000);
        if (active.length === 0) {
            buckets.delete(key);
        } else {
            buckets.set(key, active);
        }
    }
    lastCleanup = now;
}

export const checkRateLimit = (
    request: Request,
    { windowSeconds, maxRequests, prefix = 'api' }: RateLimitOptions,
): RateLimitResult => {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const ip = getClientIp(request);
    const key = `${prefix}:${ip}`;

    // Run cleanup periodically to prevent memory leak
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
        cleanupStaleBuckets(now);
    }

    const timestamps = buckets.get(key) ?? [];
    const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < windowMs);

    if (activeTimestamps.length >= maxRequests) {
        const oldestTimestamp = activeTimestamps[0] ?? now;
        const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

        buckets.set(key, activeTimestamps);

        return {
            success: false,
            remaining: 0,
            retryAfter,
        };
    }

    activeTimestamps.push(now);
    buckets.set(key, activeTimestamps);

    return {
        success: true,
        remaining: Math.max(0, maxRequests - activeTimestamps.length),
        retryAfter: 0,
    };
};

export const enforceRateLimit = (
    request: Request,
    options: RateLimitOptions,
): NextResponse | null => {
    const result = checkRateLimit(request, options);

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
    buckets.clear();
    lastCleanup = Date.now();
};
