import { NextRequest, NextResponse } from 'next/server';
import { getRateLimiterMode, probeRateLimiterHealth } from '@/lib/rateLimit';
import { requireAdminRequest } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

/**
 * Rate-limiter health check endpoint (Issue #282).
 *
 * Returns the current rate limiter mode and whether it is healthy (i.e.
 * operating in 'distributed' mode backed by Upstash Redis).
 *
 * Intended for:
 *   - Admin dashboards to surface rate-limiter health at a glance.
 *   - External monitoring / uptime checks that alert if the mode degrades
 *     from 'distributed' to 'in-memory-fallback' (Redis went away silently).
 *   - CI/CD gate: a post-deploy smoke test can call this and fail the
 *     deployment if the mode is not 'distributed' on mainnet.
 *
 * The endpoint is admin-only to prevent leaking operational details to the
 * public. For a public health check, expose only a boolean { healthy: true }
 * without the mode string.
 */
export async function GET(request: NextRequest) {
    const adminCheck = await requireAdminRequest(request);
    if (!adminCheck.ok) {
        return NextResponse.json(
            { success: false, error: adminCheck.error },
            { status: adminCheck.status },
        );
    }

    const healthy = await probeRateLimiterHealth();
    const configured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const mode = healthy ? 'distributed' : configured ? 'in-memory-fallback' : 'in-memory-unconfigured';
    const instanceMode = getRateLimiterMode();
    const isMainnet = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? '').toLowerCase() === 'mainnet';

    const status = healthy ? 200 : (isMainnet ? 503 : 200);

    return NextResponse.json(
        {
            success: true,
            rateLimiter: {
                mode,
                healthy,
                instanceMode,
                /**
                 * True when mode has degraded from 'distributed' to
                 * 'in-memory-fallback', meaning Redis was configured but is
                 * temporarily unreachable. This is the silent-degradation case
                 * the issue warns about — limits are no longer globally enforced
                 * but the app continues to run.
                 */
                degraded: mode === 'in-memory-fallback',
                /**
                 * True when Redis was never configured. On mainnet, the app
                 * should not boot in this state (guarded in initRateLimitStore).
                 */
                unconfigured: mode === 'in-memory-unconfigured',
                /**
                 * On mainnet, any non-distributed mode is a security gap.
                 * On testnet/dev, in-memory is acceptable.
                 */
                actionRequired: isMainnet && !healthy,
                network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'unknown',
            },
        },
        { status },
    );
}
