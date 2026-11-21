import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const ADMIN_POC_HANDOVER_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'admin-poc-handover',
} as const;

const idSchema = z.string().uuid();

const handoverSchema = z.object({
    newPocName: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    newPocEmail: z.string().trim().email('Invalid new POC email address').max(254),
    requesterEmail: z.string().trim().email('Invalid requester email address').max(254),
    verificationMethod: z
        .string()
        .trim()
        .min(5, 'Please specify the verification method used to confirm identity')
        .max(500),
    notes: z.string().trim().max(1000).optional(),
});

/**
 * First-class POC Handover procedure for institutional turnover.
 *
 * Implements:
 * 1. Verification record & defense (identity-verification step audit).
 * 2. Deactivation of previous POC account (preserves audit trail, never deleted).
 * 3. Association of institution with new POC.
 * 4. Automatic generation of fresh single-use invite/recovery link for the new POC.
 * 5. Full audit logging with actor admin ID, requester, previous POC, and new POC.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ADMIN_POC_HANDOVER_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const adminCheck = await requireAdminRequest(request);
        if (!adminCheck.ok) {
            return NextResponse.json(
                { success: false, error: adminCheck.error },
                { status: adminCheck.status },
            );
        }

        const { id } = await context.params;
        const parsedId = idSchema.safeParse(id);

        if (!parsedId.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid institution id' },
                { status: 400 },
            );
        }

        const body = await request.json().catch(() => ({}));
        const parsedBody = handoverSchema.safeParse(body);

        if (!parsedBody.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid handover payload',
                    details: parsedBody.error.flatten(),
                },
                { status: 400 },
            );
        }

        const { newPocName, newPocEmail, requesterEmail, verificationMethod, notes } =
            parsedBody.data;

        const supabase = getServiceRoleClient();

        // 1. Fetch target institution
        const { data: institution, error: institutionError } = await supabase
            .from('institutions')
            .select('id, name, email')
            .eq('id', parsedId.data)
            .maybeSingle();

        if (institutionError) {
            structuredLog('ERROR', 'Failed to fetch institution for POC handover', requestId, {
                error: institutionError,
                institutionId: parsedId.data,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to find institution' },
                { status: 500 },
            );
        }

        if (!institution) {
            return NextResponse.json(
                { success: false, error: 'Institution not found' },
                { status: 404 },
            );
        }

        const oldPocEmail = institution.email;

        // 2. Find the current active owner via institution_users and deactivate them (never delete).
        const { data: currentOwner, error: currentOwnerError } = await supabase
            .from('institution_users')
            .select('auth_user_id')
            .eq('institution_id', institution.id)
            .eq('status', 'active')
            .in('role', ['owner', 'poc'])
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        // Fail closed: with the legacy column gone this lookup is the only
        // record of who the outgoing POC is. Treating an error as "no owner"
        // would hand over the institution while the old POC kept access.
        if (currentOwnerError) {
            structuredLog('ERROR', 'Failed to look up the current POC membership', requestId, {
                error: currentOwnerError,
                institutionId: institution.id,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to look up the current POC' },
                { status: 500 },
            );
        }

        const oldAuthUserId = (currentOwner?.auth_user_id as string | undefined) ?? null;

        // 2. Deactivate old POC (never delete)
        if (oldAuthUserId) {
            const { error: deactivateProfileError } = await supabase
                .from('profiles')
                .update({
                    is_active: false,
                    deactivated_at: new Date().toISOString(),
                    deactivated_reason: `Replaced during POC handover to ${newPocEmail} on ${new Date().toISOString()}`,
                })
                .eq('id', oldAuthUserId);

            if (deactivateProfileError) {
                structuredLog(
                    'WARN',
                    'Failed to update old POC profile deactivation state',
                    requestId,
                    {
                        error: deactivateProfileError,
                        oldAuthUserId,
                    },
                );
            }

            // Also mark as inactive in institution_users. This is what actually
            // revokes the old POC's access, so it must not fail silently.
            const { error: deactivateMembershipError } = await supabase
                .from('institution_users')
                .update({ status: 'deactivated' })
                .eq('institution_id', institution.id)
                .eq('auth_user_id', oldAuthUserId);

            if (deactivateMembershipError) {
                structuredLog('ERROR', 'Failed to deactivate the old POC membership', requestId, {
                    error: deactivateMembershipError,
                    institutionId: institution.id,
                    oldAuthUserId,
                });
                return NextResponse.json(
                    { success: false, error: 'Failed to deactivate the current POC' },
                    { status: 500 },
                );
            }
        }

        // 3. Provision or locate new POC user in Supabase Auth
        let newAuthUserId: string | null = null;

        // Try creating new user first
        const { data: createdUser, error: createUserError } =
            await supabase.auth.admin.createUser({
                email: newPocEmail,
                email_confirm: true,
                user_metadata: {
                    name: newPocName,
                    role: 'institution',
                },
            });

        if (createUserError) {
            // If user already exists in auth, retrieve existing user ID
            if (createUserError.message.toLowerCase().includes('already')) {
                // List users to locate existing user ID
                const { data: listData, error: listError } =
                    await supabase.auth.admin.listUsers({ perPage: 1000 });
                if (!listError && listData?.users) {
                    const existing = listData.users.find(
                        (u) => u.email?.toLowerCase() === newPocEmail.toLowerCase(),
                    );
                    if (existing) {
                        newAuthUserId = existing.id;
                    }
                }
            }

            if (!newAuthUserId) {
                structuredLog('ERROR', 'Failed to create new POC user account', requestId, {
                    error: createUserError,
                    newPocEmail,
                });
                return NextResponse.json(
                    {
                        success: false,
                        error: `Failed to provision new POC user: ${createUserError.message}`,
                    },
                    { status: 500 },
                );
            }
        } else if (createdUser.user) {
            newAuthUserId = createdUser.user.id;
        }

        if (!newAuthUserId) {
            return NextResponse.json(
                { success: false, error: 'Could not resolve new POC user identifier' },
                { status: 500 },
            );
        }

        // 4. Ensure profile is provisioned as active institution role
        const { error: profileUpsertError } = await supabase.from('profiles').upsert(
            {
                id: newAuthUserId,
                email: newPocEmail,
                role: 'institution',
                full_name: newPocName,
                is_active: true,
                deactivated_at: null,
                deactivated_reason: null,
            },
            { onConflict: 'id' },
        );

        if (profileUpsertError) {
            structuredLog('WARN', 'Failed to upsert new POC profile', requestId, {
                error: profileUpsertError,
                newAuthUserId,
            });
        }

        // 5. Update institution email to reflect the new POC.
        const { error: institutionUpdateError } = await supabase
            .from('institutions')
            .update({
                email: newPocEmail,
            })
            .eq('id', institution.id);

        if (institutionUpdateError) {
            structuredLog('ERROR', 'Failed to update institution email for POC handover', requestId, {
                error: institutionUpdateError,
                institutionId: institution.id,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to update institution POC' },
                { status: 500 },
            );
        }

        // 6. Record in institution_users
        await supabase.from('institution_users').upsert(
            {
                institution_id: institution.id,
                auth_user_id: newAuthUserId,
                role: 'owner',
                status: 'active',
                invited_by: adminCheck.userId,
            },
            { onConflict: 'institution_id,auth_user_id' },
        );

        // 7. Generate direct recovery / access link for the new POC
        const origin = request.nextUrl.origin || 'http://localhost:3000';
        const redirectTo = `${origin}/auth/reset-password?next=/dashboard`;

        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: newPocEmail,
            options: {
                redirectTo,
            },
        });

        const actionLink = linkData?.properties?.action_link || null;

        if (linkError) {
            structuredLog('WARN', 'Could not generate recovery link for new POC', requestId, {
                error: linkError,
                newPocEmail,
            });
        }

        // 8. Record audit log
        const { error: auditError } = await supabase.from('admin_audit_logs').insert({
            action: 'poc_handover',
            actor_admin_id: adminCheck.userId,
            target_institution_id: institution.id,
            requester_email: requesterEmail,
            previous_poc_email: oldPocEmail,
            previous_poc_id: oldAuthUserId,
            new_poc_email: newPocEmail,
            new_poc_id: newAuthUserId,
            details: {
                newPocName,
                verificationMethod,
                notes: notes || null,
                actionLinkGenerated: Boolean(actionLink),
                oldAccountDeactivated: Boolean(oldAuthUserId),
            },
        });

        if (auditError) {
            structuredLog('WARN', 'Failed to record audit log for POC handover', requestId, {
                error: auditError,
            });
        }

        structuredLog('INFO', 'Completed POC handover successfully', requestId, {
            institutionId: institution.id,
            previousPoc: oldPocEmail,
            newPoc: newPocEmail,
            adminId: adminCheck.userId,
            requesterEmail,
        });

        return NextResponse.json({
            success: true,
            message:
                'POC handover completed successfully. Previous POC account was deactivated and fresh access credentials generated.',
            inviteLink: actionLink,
            institution: {
                id: institution.id,
                name: institution.name,
                email: newPocEmail,
            },
            previousPoc: {
                email: oldPocEmail,
                deactivated: true,
            },
        });
    } catch (error) {
        captureException(error, { context: 'adminPocHandover', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to complete POC handover' },
            { status: 500 },
        );
    }
}
