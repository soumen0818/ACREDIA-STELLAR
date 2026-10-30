import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rateLimit';
import { getServiceRoleClient, requireInstitutionRequest } from '@/lib/serverAuth';
import { canWrite } from '@/lib/institutionMembership';
import { captureException } from '@/lib/debug';
import {
    CREDENTIAL_DOCUMENTS_BUCKET,
    credentialDocumentExtension,
    sha256Hex,
    validateCredentialDocument,
} from '@/lib/credentialDocuments';

export const dynamic = 'force-dynamic';

// Coarse per-IP limit, applied before any auth work so anonymous floods cannot
// drive Supabase token verification.
const DOCUMENT_UPLOAD_IP_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'credential-document-ip',
} as const;

// Per-account quota: uploads spend project storage.
const DOCUMENT_UPLOAD_USER_QUOTA = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'credential-document-user',
} as const;

/**
 * POST /api/institution/documents
 *
 * Stores a credential document in the private `credential-documents` bucket
 * (review §3.11) and returns its path and SHA-256. The digest goes into the
 * credential JSON, so the on-chain hash covers the document; the file itself
 * is only ever served through short-lived signed URLs.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const ipRateLimitResponse = await enforceRateLimit(request, DOCUMENT_UPLOAD_IP_RATE_LIMIT);
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

        // Uploading is part of issuing; read-only members may not (Issue #307).
        if (authCheck.memberRole && !canWrite(authCheck.memberRole)) {
            return NextResponse.json(
                { success: false, error: 'Your role is read-only and cannot upload credentials.' },
                { status: 403 },
            );
        }

        if (!authCheck.institutionId) {
            return NextResponse.json(
                { success: false, error: 'Your account is not linked to an institution.' },
                { status: 403 },
            );
        }

        const userRateLimitResponse = await enforceRateLimit(request, {
            ...DOCUMENT_UPLOAD_USER_QUOTA,
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

        const validationError = validateCredentialDocument(file);
        if (validationError) {
            return NextResponse.json({ success: false, error: validationError }, { status: 400 });
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const sha256 = await sha256Hex(bytes);
        // Random name inside the institution's folder: the path reveals
        // nothing about the student and cannot be guessed.
        const path = `${authCheck.institutionId}/${crypto.randomUUID()}.${credentialDocumentExtension(file.type)}`;

        const { error: uploadError } = await getServiceRoleClient()
            .storage.from(CREDENTIAL_DOCUMENTS_BUCKET)
            .upload(path, bytes, { contentType: file.type, upsert: false });

        if (uploadError) {
            throw uploadError;
        }

        return NextResponse.json({ success: true, path, sha256 });
    } catch (error: unknown) {
        captureException(error, { requestId, context: 'POST /api/institution/documents' });
        return NextResponse.json(
            { success: false, error: 'Failed to store the document.' },
            { status: 500 },
        );
    }
}
