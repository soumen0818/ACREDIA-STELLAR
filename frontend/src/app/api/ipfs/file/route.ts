import { NextRequest, NextResponse } from 'next/server';
import { pinFileToPinata, validatePinataFile } from '@/lib/ipfsServer';
import { enforceRateLimit } from '@/lib/rateLimit';
import { requireInstitutionRequest } from '@/lib/serverAuth';
import { canWrite } from '@/lib/institutionMembership';
import { captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

// Coarse per-IP limit, applied before any auth work so anonymous floods cannot
// drive Supabase token verification.
const IPFS_FILE_IP_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'ipfs-file-ip',
} as const;

// Per-account quota. Pinning spends the project's Pinata storage and bandwidth,
// so an authenticated issuer still cannot burn it from many source addresses.
const IPFS_FILE_USER_QUOTA = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'ipfs-file-user',
} as const;

export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const ipRateLimitResponse = await enforceRateLimit(request, IPFS_FILE_IP_RATE_LIMIT);
        if (ipRateLimitResponse) {
            return ipRateLimitResponse;
        }

        const authCheck = await requireInstitutionRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            );
        }

        // Pinning is part of issuing; read-only members may not (Issue #307).
        if (authCheck.memberRole && !canWrite(authCheck.memberRole)) {
            return NextResponse.json(
                { success: false, error: 'Your role is read-only and cannot upload credentials.' },
                { status: 403 },
            );
        }

        const userRateLimitResponse = await enforceRateLimit(request, {
            ...IPFS_FILE_USER_QUOTA,
            identifier: authCheck.userId,
        });
        if (userRateLimitResponse) {
            return userRateLimitResponse;
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
