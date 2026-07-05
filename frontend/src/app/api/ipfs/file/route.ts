import { NextResponse } from 'next/server';
import { pinFileToPinata, validatePinataFile } from '@/lib/ipfsServer';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const IPFS_FILE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'ipfs-file',
} as const;

export async function POST(request: Request) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, IPFS_FILE_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!(file instanceof File)) {
            return NextResponse.json(
                { success: false, error: 'A file is required.' },
                { status: 400 },
            );
        }

        const validationError = validatePinataFile(file);

        if (validationError) {
            return NextResponse.json({ success: false, error: validationError }, { status: 400 });
        }

        const cid = await pinFileToPinata(file);

        return NextResponse.json({ success: true, cid });
    } catch (error: unknown) {
        captureException(error, { requestId, context: 'POST /api/ipfs/file' });
        return NextResponse.json(
            { success: false, error: 'Failed to upload file to IPFS.' },
            { status: 500 },
        );
    }
}
