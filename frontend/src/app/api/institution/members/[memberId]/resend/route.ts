import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException, structuredLog } from '@/lib/debug';
import {
    MemberInviteError,
    MemberResendError,
    resendMemberInvitation,
} from '@/lib/institutionMembers';
import { memberInviteRedirect, requireInstitutionMemberRequest } from '@/lib/memberRouteAuth';

export const dynamic = 'force-dynamic';

// Each resend emails a third party; keep it well below anything abusive.
const MEMBER_RESEND_RATE_LIMIT = {
    windowSeconds: 3600,
    maxRequests: 10,
    prefix: 'institution-member-resend',
} as const;

const idSchema = z.string().uuid();

/**
 * POST /api/institution/members/[memberId]/resend — email a pending or expired
 * invitation again and restart its 7-day window. Owners only.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ memberId: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const auth = await requireInstitutionMemberRequest(request, { manage: true });
        if (!auth.ok) {
            return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
        }

        const rateLimitResponse = await enforceRateLimit(request, {
            ...MEMBER_RESEND_RATE_LIMIT,
            identifier: auth.institutionId,
        });
        if (rateLimitResponse) return rateLimitResponse;

        const { memberId } = await context.params;
        const parsedId = idSchema.safeParse(memberId);
        if (!parsedId.success) {
            return NextResponse.json({ success: false, error: 'Invalid member id' }, { status: 400 });
        }

        const result = await resendMemberInvitation(auth.client, {
            institutionId: auth.institutionId,
            memberId: parsedId.data,
            redirectTo: memberInviteRedirect(request),
        });

        const { error: auditError } = await auth.client.from('admin_audit_logs').insert({
            action: 'resend_member_invite',
            target_institution_id: auth.institutionId,
            new_poc_email: result.email,
            new_poc_id: result.authUserId,
            details: { actorUserId: auth.userId, inviteExpiresAt: result.inviteExpiresAt },
        });
        if (auditError) {
            structuredLog('WARN', 'Failed to record the invitation resend audit log', requestId, {
                error: auditError,
            });
        }

        return NextResponse.json({
            success: true,
            inviteExpiresAt: result.inviteExpiresAt,
            message: `Invitation emailed again to ${result.email}.`,
        });
    } catch (error) {
        if (error instanceof MemberResendError || error instanceof MemberInviteError) {
            return NextResponse.json(
                { success: false, code: error.code, error: error.message },
                { status: error.status },
            );
        }
        captureException(error, {
            requestId,
            context: 'POST /api/institution/members/[memberId]/resend',
        });
        return NextResponse.json(
            { success: false, error: 'Failed to resend the invitation' },
            { status: 500 },
        );
    }
}
