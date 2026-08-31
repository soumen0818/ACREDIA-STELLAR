import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { canWrite, resolveInstitutionForUser } from '@/lib/institutionMembership';
import { isValidStellarAddress } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

const STUDENT_WRITE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 30,
    prefix: 'institution-student-write',
} as const;

const idSchema = z.string().uuid();

const patchSchema = z
    .object({
        name: z.string().trim().min(2).max(200).optional(),
        studentRef: z.string().trim().max(64).nullable().optional(),
        walletAddress: z
            .string()
            .trim()
            .refine(isValidStellarAddress, 'Not a valid Stellar address')
            .nullable()
            .optional(),
        status: z.enum(['active', 'deactivated']).optional(),
        deactivatedReason: z.string().trim().max(500).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: 'No changes supplied',
    });

/**
 * Updates one student on the calling institution's roster.
 *
 * Handles correction (name, student id, wallet) and lifecycle (deactivate /
 * reactivate) in one place, because both are "edit this roster row" from the
 * institution's point of view.
 *
 * Email is deliberately not editable: it identifies the account an invite was
 * or will be sent to, and silently repointing it would hand one student's
 * pending invite to a different address.
 */
export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, STUDENT_WRITE_RATE_LIMIT);
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

        const body = await request.json().catch(() => ({}));
        const parsed = patchSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid update', details: parsed.error.flatten() },
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
                { success: false, error: 'Your role does not permit managing students' },
                { status: 403 },
            );
        }

        // Scoping the read by institution_id is what stops one institution
        // editing another's student by guessing an id.
        const { data: student, error: findError } = await supabase
            .from('students')
            .select('id, name, email, student_ref, wallet_address, status, auth_user_id')
            .eq('id', parsedId.data)
            .eq('institution_id', membership.institutionId)
            .maybeSingle();

        if (findError) {
            structuredLog('ERROR', 'Failed to load student for update', requestId, {
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

        const updates = parsed.data;
        const patch: Record<string, unknown> = {};

        if (updates.name !== undefined) patch.name = updates.name;
        if (updates.studentRef !== undefined) patch.student_ref = updates.studentRef || null;

        if (updates.walletAddress !== undefined) {
            const wallet = updates.walletAddress || null;

            if (wallet && wallet !== student.wallet_address) {
                const { data: clash } = await supabase
                    .from('students')
                    .select('id')
                    .eq('wallet_address', wallet)
                    .neq('id', student.id)
                    .maybeSingle();

                if (clash) {
                    return NextResponse.json(
                        {
                            success: false,
                            error: 'That wallet address is already linked to another student.',
                        },
                        { status: 409 },
                    );
                }
            }

            patch.wallet_address = wallet;
        }

        if (updates.status !== undefined) {
            patch.status = updates.status;

            if (updates.status === 'deactivated') {
                patch.deactivated_at = new Date().toISOString();
                patch.deactivated_reason = updates.deactivatedReason || null;
            } else {
                patch.deactivated_at = null;
                patch.deactivated_reason = null;
            }
        }

        const { data: updated, error: updateError } = await supabase
            .from('students')
            .update(patch)
            .eq('id', student.id)
            .eq('institution_id', membership.institutionId)
            .select(
                'id, name, email, student_ref, wallet_address, status, auth_user_id, invited_at, invite_accepted_at, claimed_at, deactivated_at, created_at',
            )
            .single();

        if (updateError || !updated) {
            structuredLog('ERROR', 'Failed to update student', requestId, { error: updateError });
            return NextResponse.json(
                { success: false, error: 'Failed to update student' },
                { status: 500 },
            );
        }

        const action =
            updates.status === 'deactivated'
                ? 'deactivate_student'
                : updates.status === 'active'
                  ? 'reactivate_student'
                  : 'update_student';

        const { error: auditError } = await supabase.from('admin_audit_logs').insert({
            action,
            actor_admin_id: authCheck.userId,
            target_institution_id: membership.institutionId,
            details: {
                studentId: student.id,
                studentEmail: student.email,
                changed: Object.keys(patch),
                reason: updates.deactivatedReason || null,
                // Stated explicitly because it is the property most likely to
                // be misremembered: access changes, credentials do not.
                credentialsUnaffected: true,
            },
        });

        if (auditError) {
            structuredLog('WARN', 'Failed to audit student update', requestId, {
                error: auditError,
            });
        }

        return NextResponse.json({
            success: true,
            student: {
                id: updated.id,
                name: updated.name,
                email: updated.email,
                studentRef: updated.student_ref ?? null,
                walletAddress: updated.wallet_address ?? null,
                status: updated.status,
                hasAccount: Boolean(updated.auth_user_id),
                invitedAt: updated.invited_at ?? null,
                inviteAcceptedAt: updated.invite_accepted_at ?? null,
                claimedAt: updated.claimed_at ?? null,
                deactivatedAt: updated.deactivated_at ?? null,
                createdAt: updated.created_at ?? null,
            },
        });
    } catch (error) {
        captureException(error, { context: 'institutionStudentUpdate', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to update student' },
            { status: 500 },
        );
    }
}
