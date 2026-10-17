import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException, structuredLog } from '@/lib/debug';
import { changeInstitutionMember, MemberChangeError } from '@/lib/institutionMembers';
import { normalizeMemberRole } from '@/lib/institutionMembership';
import { requireInstitutionMemberRequest } from '@/lib/memberRouteAuth';

export const dynamic = 'force-dynamic';

const MEMBER_CHANGE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 30,
    prefix: 'institution-member-change',
} as const;

const idSchema = z.string().uuid();
const roleSchema = z.object({ role: z.enum(['owner', 'issuer', 'viewer']) });

type RouteContext = { params: Promise<{ memberId: string }> };

async function handleChange(
    request: NextRequest,
    context: RouteContext,
    action: 'remove' | 'set_role',
): Promise<NextResponse> {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, MEMBER_CHANGE_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const auth = await requireInstitutionMemberRequest(request, { manage: true });
        if (!auth.ok) {
            return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
        }

        const { memberId } = await context.params;
        const parsedId = idSchema.safeParse(memberId);
        if (!parsedId.success) {
            return NextResponse.json({ success: false, error: 'Invalid member id' }, { status: 400 });
        }

        let role: z.infer<typeof roleSchema>['role'] | undefined;
        if (action === 'set_role') {
            const parsedBody = roleSchema.safeParse(await request.json().catch(() => ({})));
            if (!parsedBody.success) {
                return NextResponse.json(
                    { success: false, error: 'Role must be owner, issuer or viewer.' },
                    { status: 400 },
                );
            }
            role = parsedBody.data.role;
        }

        const changed = await changeInstitutionMember(auth.client, {
            institutionId: auth.institutionId,
            memberId: parsedId.data,
            action,
            role,
            actorId: auth.userId,
        });

        const { error: auditError } = await auth.client.from('admin_audit_logs').insert({
            action: action === 'remove' ? 'remove_member' : 'change_member_role',
            target_institution_id: auth.institutionId,
            previous_poc_id: changed.authUserId,
            details: {
                actorUserId: auth.userId,
                memberId: changed.id,
                selfService: true,
                ...(action === 'set_role' ? { newRole: role } : { removedRole: normalizeMemberRole(changed.role) }),
                leftTeam: action === 'remove' && changed.authUserId === auth.userId,
            },
        });
        if (auditError) {
            structuredLog('WARN', 'Failed to record the member change audit log', requestId, {
                error: auditError,
            });
        }

        structuredLog('INFO', 'Institution member changed', requestId, {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action,
        });

        return NextResponse.json({
            success: true,
            member: { id: changed.id, role: normalizeMemberRole(changed.role), status: changed.status },
        });
    } catch (error) {
        if (error instanceof MemberChangeError) {
            return NextResponse.json(
                { success: false, code: error.code, error: error.message },
                { status: error.status },
            );
        }
        captureException(error, {
            requestId,
            context: `${action === 'remove' ? 'DELETE' : 'PATCH'} /api/institution/members/[memberId]`,
        });
        return NextResponse.json(
            { success: false, error: 'Failed to update the member' },
            { status: 500 },
        );
    }
}

/**
 * PATCH /api/institution/members/[memberId] — change a member's role. Owners
 * only. Refused when it would leave no owner or no one able to issue.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    return handleChange(request, context, 'set_role');
}

/**
 * DELETE /api/institution/members/[memberId] — remove a member or withdraw an
 * invitation. Owners only; an owner may remove themselves. Refused when it
 * would leave no owner or no one able to issue. The membership is deactivated,
 * never deleted, so who held issuing rights stays auditable.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
    return handleChange(request, context, 'remove');
}
