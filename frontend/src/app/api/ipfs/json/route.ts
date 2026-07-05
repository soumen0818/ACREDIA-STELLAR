import { NextResponse } from 'next/server';
import { pinJsonToPinata, validatePinataJson } from '@/lib/ipfsServer';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const IPFS_JSON_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'ipfs-json',
} as const;

export async function POST(request: Request) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, IPFS_JSON_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const payload = await request.json();
        const content = payload?.content;
        const validationError = validatePinataJson(content);

        if (validationError) {
            return NextResponse.json({ success: false, error: validationError }, { status: 400 });
        }

        const cid = await pinJsonToPinata(content);

        return NextResponse.json({ success: true, cid });
    } catch (error: unknown) {
        captureException(error, { requestId, context: 'POST /api/ipfs/json' });
        return NextResponse.json(
            { success: false, error: 'Failed to upload JSON to IPFS.' },
            { status: 500 },
        );
    }
}
