import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { canWrite, resolveInstitutionForUser } from '@/lib/institutionMembership';

export const dynamic = 'force-dynamic';

const STUDENT_INVITE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'institution-student-invite',
} as const;

const idSchema = z.string().uuid();

/** Matches the institution invite lifetime (Issue #240). */
const INVITE_TTL_DAYS = 7;

/**
 * Generates a single-use, expiring invite link for one of the calling
 * institution's students.
 *
 * The link is returned for copying rather than relying on mail: an institution
 * must never be unable to onboard a student because of a deliverability
 * problem. Supabase mails it as well, but the copyable link is the contract.
 *
 * Generating a new link invalidates any previous one, because Supabase
 * replaces the user's token hash when it issues the next.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, STUDENT_INVITE_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            );
        }

        const { id } = await context.params;
        const parsedId = idSchema.safeParse(id);
        if (!parsedId.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid student id' },
                { status: 400 },
            );
        }

        const supabase = getServiceRoleClient();
        const membership = await resolveInstitutionForUser(supabase, authCheck.userId);

        if (!membership) {
            return NextResponse.json(
                { success: false, error: 'Institution access required' },
                { status: 403 },
            );
        }

        if (!canWrite(membership.role)) {
            return NextResponse.json(
                { success: false, error: 'Your role does not permit inviting students' },
                { status: 403 },
            );
        }

        const { data: student, error: findError } = await supabase
            .from('students')
            .select('id, name, email, status, auth_user_id')
            .eq('id', parsedId.data)
            .eq('institution_id', membership.institutionId)
            .maybeSingle();

        if (findError) {
            structuredLog('ERROR', 'Failed to load student for invite', requestId, {
                error: findError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to load student' },
                { status: 500 },
            );
        }

        if (!student) {
            return NextResponse.json(
                { success: false, error: 'Student not found' },
                { status: 404 },
            );
        }

        if (student.status === 'deactivated') {
            return NextResponse.json(
                {
                    success: false,
                    error: 'This student is deactivated. Reactivate them before sending an invite.',
                },
                { status: 409 },
            );
        }

        // Provision the auth user on first invite. The student sets their own
        // password from the link, so no password is ever chosen for them.
        let authUserId = student.auth_user_id as string | null;

        if (!authUserId) {
            const { data: created, error: createError } = await supabase.auth.admin.createUser({
                email: student.email,
                email_confirm: true,
                user_metadata: { name: student.name, role: 'student' },
            });

            if (createError) {
                if (createError.message.toLowerCase().includes('already')) {
                    const { data: listData } = await supabase.auth.admin.listUsers({
                        perPage: 1000,
                    });
                    authUserId =
                        listData?.users.find(
                            (user) => user.email?.toLowerCase() === student.email.toLowerCase(),
                        )?.id ?? null;
                }

                if (!authUserId) {
                    structuredLog('ERROR', 'Failed to provision student auth user', requestId, {
                        error: createError,
                    });
                    return NextResponse.json(
                        {
                            success: false,
                            error: `Failed to provision student account: ${createError.message}`,
                        },
                        { status: 500 },
                    );
                }
            } else {
                authUserId = created.user?.id ?? null;
            }

            if (authUserId) {
                await supabase.from('profiles').upsert(
                    {
                        id: authUserId,
                        email: student.email,
                        role: 'student',
                        full_name: student.name,
                        is_active: true,
                    },
                    { onConflict: 'id' },
                );
            }
        }

        if (!authUserId) {
            return NextResponse.json(
                { success: false, error: 'Could not resolve the student account' },
                { status: 500 },
            );
        }

        const origin = request.nextUrl.origin || 'http://localhost:3000';
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'invite',
            email: student.email,
            options: { redirectTo: `${origin}/auth/accept-invite?next=/student` },
        });

        const inviteLink = linkData?.properties?.action_link ?? null;

        if (linkError || !inviteLink) {
            structuredLog('ERROR', 'Student invite link generation failed', requestId, {
                error: linkError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to generate the invite link' },
                { status: 500 },
            );
        }

        const invitedAt = new Date();
        const inviteExpiresAt = new Date(
            invitedAt.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
        );

        const { error: updateError } = await supabase
            .from('students')
            .update({
                auth_user_id: authUserId,
                invited_at: invitedAt.toISOString(),
                invite_expires_at: inviteExpiresAt.toISOString(),
                invite_accepted_at: null,
            })
            .eq('id', student.id)
            .eq('institution_id', membership.institutionId);

        if (updateError) {
            structuredLog('WARN', 'Failed to record the student invite window', requestId, {
                error: updateError,
            });
        }

        const { error: auditError } = await supabase.from('admin_audit_logs').insert({
            action: 'generate_student_invite',
            actor_admin_id: authCheck.userId,
            target_institution_id: membership.institutionId,
            new_poc_email: student.email,
            new_poc_id: authUserId,
            details: {
                studentId: student.id,
                singleUse: true,
                inviteExpiresAt: inviteExpiresAt.toISOString(),
            },
        });

        if (auditError) {
            structuredLog('WARN', 'Failed to audit student invite', requestId, {
                error: auditError,
            });
        }

        return NextResponse.json({
            success: true,
            inviteLink,
            email: student.email,
            inviteExpiresAt: inviteExpiresAt.toISOString(),
            message:
                'Single-use invite link generated. Any previously generated link is now invalid.',
        });
    } catch (error) {
        captureException(error, { context: 'institutionStudentInvite', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to generate the invite link' },
            { status: 500 },
        );
    }
}
