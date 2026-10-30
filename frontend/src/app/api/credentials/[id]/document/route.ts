import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rateLimit';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { CREDENTIAL_DOCUMENTS_BUCKET } from '@/lib/credentialDocuments';
import { captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const DOCUMENT_ACCESS_IP_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'credential-document-access-ip',
} as const;

const DOCUMENT_ACCESS_USER_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 30,
    prefix: 'credential-document-access-user',
} as const;

const DOCUMENT_URL_TTL_SECONDS = 300;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

function notFound() {
    // Also used for "not yours": the response does not reveal whether a
    // credential exists.
    return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404, headers: NO_STORE },
    );
}

/** The holder: the student row the credential was issued to belongs to the caller. */
async function isHolder(supabase: ServiceRoleClient, userId: string, studentId: unknown) {
    if (typeof studentId !== 'string') return false;
    const { data } = await supabase
        .from('students')
        .select('id')
        .eq('id', studentId)
        .eq('auth_user_id', userId)
        .maybeSingle();
    return Boolean(data);
}

/** Any active member of the issuing institution, or its legacy owner account. */
async function isIssuingInstitutionMember(
    supabase: ServiceRoleClient,
    userId: string,
    institutionId: unknown,
) {
    if (typeof institutionId !== 'string') return false;
    const { data: membership } = await supabase
        .from('institution_users')
        .select('id')
        .eq('auth_user_id', userId)
        .eq('institution_id', institutionId)
        .eq('status', 'active')
        .maybeSingle();
    if (membership) return true;

    const { data: owner } = await supabase
        .from('institutions')
        .select('id')
        .eq('id', institutionId)
        .eq('auth_user_id', userId)
        .maybeSingle();
    return Boolean(owner);
}

/**
 * GET /api/credentials/:id/document
 *
 * A short-lived signed URL for a credential's private document (review
 * §3.11b), for its holder or a member of the institution that issued it.
 * Anyone else uses the holder's share link.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const ipLimited = await enforceRateLimit(request, DOCUMENT_ACCESS_IP_RATE_LIMIT);
        if (ipLimited) return ipLimited;

        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status, headers: NO_STORE },
            );
        }

        const userLimited = await enforceRateLimit(request, {
            ...DOCUMENT_ACCESS_USER_RATE_LIMIT,
            identifier: authCheck.userId,
        });
        if (userLimited) return userLimited;

        const { id } = await params;
        if (!UUID.test(id)) {
            return notFound();
        }

        const supabase = getServiceRoleClient();
        const { data: credential, error } = await supabase
            .from('credentials')
            .select('id, student_id, institution_id, document_path, document_sha256')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!credential?.document_path || !credential.document_sha256) {
            return notFound();
        }

        const allowed =
            (await isHolder(supabase, authCheck.userId, credential.student_id)) ||
            (await isIssuingInstitutionMember(supabase, authCheck.userId, credential.institution_id));
        if (!allowed) {
            return notFound();
        }

        const { data: signed, error: signError } = await supabase.storage
            .from(CREDENTIAL_DOCUMENTS_BUCKET)
            .createSignedUrl(credential.document_path as string, DOCUMENT_URL_TTL_SECONDS);
        if (signError || !signed?.signedUrl) {
            throw signError ?? new Error('No signed URL returned');
        }

        return NextResponse.json(
            {
                success: true,
                url: signed.signedUrl,
                sha256: credential.document_sha256,
                expiresInSeconds: DOCUMENT_URL_TTL_SECONDS,
            },
            { headers: NO_STORE },
        );
    } catch (error: unknown) {
        captureException(error, { requestId, context: 'GET /api/credentials/[id]/document' });
        return NextResponse.json(
            { success: false, error: 'Failed to load the document.' },
            { status: 500, headers: NO_STORE },
        );
    }
}
