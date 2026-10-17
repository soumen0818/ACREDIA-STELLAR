import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException, structuredLog } from '@/lib/debug';
import {
    inviteInstitutionMember,
    listInstitutionTeam,
    MemberInviteError,
} from '@/lib/institutionMembers';
import { memberInviteRedirect, requireInstitutionMemberRequest } from '@/lib/memberRouteAuth';

export const dynamic = 'force-dynamic';

const MEMBERS_IP_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'institution-members-ip',
} as const;

// Every invitation sends an email to a third party; bound it per institution.
const MEMBER_INVITE_QUOTA = {
    windowSeconds: 3600,
    maxRequests: 20,
    prefix: 'institution-member-invite',
} as const;

const inviteSchema = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    role: z.enum(['owner', 'issuer', 'viewer']),
});

/**
 * GET /api/institution/members — the caller's team and its continuity status
 * (Issue #307). Any active member may read it; it drives the console warning.
 */
export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, MEMBERS_IP_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const auth = await requireInstitutionMemberRequest(request);
        if (!auth.ok) {
            return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
        }

        const team = await listInstitutionTeam(auth.client, auth.institutionId, auth.userId);

        return NextResponse.json({
            success: true,
            canManage: auth.canManage,
            ...team,
        });
    } catch (error) {
        captureException(error, { requestId, context: 'GET /api/institution/members' });
        return NextResponse.json(
            { success: false, error: 'Failed to load your team' },
            { status: 500 },
        );
    }
}

/**
 * POST /api/institution/members — invite a member by email. Owners only.
 *
 * The link goes to the invitee's inbox and is never returned here: an inviter
 * who could open it could impersonate the person they invited.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, MEMBERS_IP_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const auth = await requireInstitutionMemberRequest(request, { manage: true });
        if (!auth.ok) {
            return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
        }

        const quotaResponse = await enforceRateLimit(request, {
            ...MEMBER_INVITE_QUOTA,
            identifier: auth.institutionId,
        });
        if (quotaResponse) return quotaResponse;

        const body = await request.json().catch(() => ({}));
        const parsed = inviteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid invitation',
                    details: parsed.error.flatten(),
                },
                { status: 400 },
            );
        }

        const result = await inviteInstitutionMember(auth.client, {
            institutionId: auth.institutionId,
            inviterId: auth.userId,
            inviterEmail: auth.email,
            email: parsed.data.email,
            name: parsed.data.name,
            role: parsed.data.role,
            redirectTo: memberInviteRedirect(request),
        });

        const { error: auditError } = await auth.client.from('admin_audit_logs').insert({
            action: 'invite_member',
            target_institution_id: auth.institutionId,
            new_poc_email: parsed.data.email,
            new_poc_id: result.authUserId,
            details: {
                actorUserId: auth.userId,
                role: parsed.data.role,
                reinvited: result.reinvited,
                inviteExpiresAt: result.inviteExpiresAt,
            },
        });
        if (auditError) {
            structuredLog('WARN', 'Failed to record the member invitation audit log', requestId, {
                error: auditError,
            });
        }

        structuredLog('INFO', 'Institution member invited', requestId, {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            role: parsed.data.role,
            reinvited: result.reinvited,
        });

        return NextResponse.json(
            {
                success: true,
                memberId: result.memberId,
                inviteExpiresAt: result.inviteExpiresAt,
                message: `Invitation emailed to ${parsed.data.email}. It expires in 7 days.`,
            },
            { status: 201 },
        );
    } catch (error) {
        if (error instanceof MemberInviteError) {
            return NextResponse.json(
                { success: false, code: error.code, error: error.message },
                { status: error.status },
            );
        }
        captureException(error, { requestId, context: 'POST /api/institution/members' });
        return NextResponse.json(
            { success: false, error: 'Failed to send the invitation' },
            { status: 500 },
        );
    }
}
