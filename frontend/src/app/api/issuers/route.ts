import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rateLimit';
import { createRegistryClient, fetchVerifiedIssuers } from '@/lib/issuerRegistry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/issuers
 *
 * Public issuer trust registry — Issue #171.
 * Returns verified institutions with public, non-PII fields only.
 * No authentication required; rate-limited by IP.
 *
 * Response shape:
 * {
 *   success: true,
 *   issuers: Array<{
 *     id: string;
 *     name: string;
 *     wallet_address: string | null;
 *     authorization_tx_hash: string | null;
 *     verified_at: string;          // ISO timestamp (created_at of institution row)
 *   }>
 * }
 */
export async function GET(request: NextRequest) {
    const rateLimitResponse = await enforceRateLimit(request, {
        windowSeconds: 60,
        maxRequests: 60,
        prefix: 'issuers-public',
    });
    if (rateLimitResponse) return rateLimitResponse;

    const client = createRegistryClient();

    if (!client) {
        return NextResponse.json(
            { success: false, error: 'Service temporarily unavailable.' },
            { status: 503 },
        );
    }

    let issuers;
    try {
        issuers = await fetchVerifiedIssuers(client);
    } catch {
        return NextResponse.json(
            { success: false, error: 'Failed to fetch issuer registry.' },
            { status: 500 },
        );
    }

    return NextResponse.json(
        { success: true, issuers },
        {
            headers: {
                // Allow CDN / browser caching for up to 5 minutes — the list
                // changes infrequently (only when admin verifies an institution).
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
            },
        },
    );
}
