import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rateLimit';
import { getServiceHealth, HEALTH_CACHE_SECONDS } from '@/lib/serviceHealth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — public service health (Issue #312).
 *
 * No authentication; rate-limited by IP. Each dependency is probed with a
 * short timeout and the report is reused for HEALTH_CACHE_SECONDS, so polling
 * this does not reach the dependencies more often than that.
 *
 * Response (fixed words only: no hostnames, versions or error details):
 * {
 *   status: 'operational' | 'degraded' | 'outage',
 *   checkedAt: string,  // ISO 8601
 *   dependencies: {
 *     blockchain, database, auth, storage, rateLimiting:
 *       'operational' | 'degraded' | 'outage'
 *   }
 * }
 *
 * 200 while the product works (operational or degraded), 503 on an outage, so
 * an uptime monitor can alert on the status code alone.
 */
export async function GET(request: NextRequest) {
    const rateLimitResponse = await enforceRateLimit(request, {
        windowSeconds: 60,
        maxRequests: 30,
        prefix: 'health',
    });
    if (rateLimitResponse) return rateLimitResponse;

    const report = await getServiceHealth();

    return NextResponse.json(report, {
        status: report.status === 'outage' ? 503 : 200,
        headers: {
            'Cache-Control': `public, max-age=${HEALTH_CACHE_SECONDS}, s-maxage=${HEALTH_CACHE_SECONDS}`,
        },
    });
}
