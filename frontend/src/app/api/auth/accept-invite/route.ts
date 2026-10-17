import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { isInviteExpired } from '@/lib/institutionContinuity';
import { normalizeMemberRole } from '@/lib/institutionMembership';

export const dynamic = 'force-dynamic';

const ACCEPT_INVITE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'accept-invite',
} as const;

interface MembershipRow {
    id: string;
    institution_id: string;
    role: string;
    status: string;
    invite_expires_at: string | null;
}

/**
 * Activates the caller's pending institution membership, once they have
 * followed their invite link and set their own password.
 *
 * Works per membership, not per institution: an institution's POC and every
 * member its owners invite later each accept their own invitation (Issue
 * #307). Before this, acceptance was keyed on the institution's single
 * `invite_accepted_at`, so once the POC had accepted, every later member's
 * acceptance returned early and left them unable to act.
 *
 * Only the invited user can call this: memberships are resolved from the
 * caller's verified session, never from the request body.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ACCEPT_INVITE_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            );
        }

        const supabase = getServiceRoleClient();
        const now = new Date();

        const { data: membershipRows, error: membershipError } = await supabase
            .from('institution_users')
            .select('id, institution_id, role, status, invite_expires_at')
            .eq('auth_user_id', authCheck.userId)
            .order('created_at', { ascending: true });

        if (membershipError) {
            structuredLog('ERROR', 'Failed to load memberships for invite acceptance', requestId, {
                error: membershipError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to complete onboarding' },
                { status: 500 },
            );
        }

        const memberships = (membershipRows ?? []) as MembershipRow[];
        const pending = memberships.filter((row) => row.status === 'invited');
        const acceptable = pending.filter((row) => !isInviteExpired(row.invite_expires_at, now));

        if (pending.length > 0 && acceptable.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    code: 'invite_expired',
                    error: "This invitation has expired. Ask your institution's owner to resend it, or contact Acredia if you were invited by Acredia.",
                },
                { status: 410 },
            );
        }

        // Nothing pending: either already accepted, or a legacy POC whose
        // institution predates memberships.
        if (acceptable.length === 0) {
            const active = memberships.find((row) => row.status === 'active');

            // Every membership was removed: the old invite link must not
            // reopen access through the legacy single-login column.
            if (!active && memberships.length > 0) {
                return NextResponse.json(
                    {
                        success: false,
                        code: 'membership_removed',
                        error: "Your access to this institution was removed. Ask its owner to invite you again if that's a mistake.",
                    },
                    { status: 403 },
                );
            }

            const institutionQuery = supabase.from('institutions').select('id, name, invite_accepted_at');
            const { data: institution, error: institutionError } = await (active
                ? institutionQuery.eq('id', active.institution_id)
                : institutionQuery.eq('auth_user_id', authCheck.userId)
            ).maybeSingle();

            if (institutionError) {
                structuredLog('ERROR', 'Failed to load institution for invite acceptance', requestId, {
                    error: institutionError,
                });
                return NextResponse.json(
                    { success: false, error: 'Failed to complete onboarding' },
                    { status: 500 },
                );
            }

            if (!institution) {
                return NextResponse.json(
                    { success: false, error: 'No institution is linked to this account' },
                    { status: 404 },
                );
            }

            if (!institution.invite_accepted_at && !active) {
                await supabase
                    .from('institutions')
                    .update({ invite_accepted_at: now.toISOString() })
                    .eq('id', institution.id);
            }

            return NextResponse.json({
                success: true,
                alreadyAccepted: Boolean(active),
                institution: { id: institution.id, name: institution.name },
                role: normalizeMemberRole(active?.role ?? 'owner'),
            });
        }

        const acceptedAt = now.toISOString();
        let firstAccepted: { institutionId: string; role: string } | null = null;

        for (const membership of acceptable) {
            const { error: activateError } = await supabase
                .from('institution_users')
                .update({ status: 'active', accepted_at: acceptedAt })
                .eq('id', membership.id)
                .eq('status', 'invited');

            if (activateError) {
                structuredLog('ERROR', 'Failed to activate the membership', requestId, {
                    error: activateError,
                    institutionId: membership.institution_id,
                });
                return NextResponse.json(
                    { success: false, error: 'Failed to complete onboarding' },
                    { status: 500 },
                );
            }

            firstAccepted ??= { institutionId: membership.institution_id, role: membership.role };

            // The institution-level fields describe its first onboarding; the
            // first member to accept completes it.
            await supabase
                .from('institutions')
                .update({ invite_accepted_at: acceptedAt })
                .eq('id', membership.institution_id)
                .is('invite_accepted_at', null);

            const { error: auditError } = await supabase.from('admin_audit_logs').insert({
                action: 'accept_invite',
                target_institution_id: membership.institution_id,
                new_poc_id: authCheck.userId,
                new_poc_email: authCheck.user.email ?? null,
                details: {
                    acceptedAt,
                    role: normalizeMemberRole(membership.role),
                    inviteExpiresAt: membership.invite_expires_at,
                },
            });

            if (auditError) {
                structuredLog('WARN', 'Failed to record the invite acceptance audit log', requestId, {
                    error: auditError,
                });
            }
        }

        const { data: institution } = await supabase
            .from('institutions')
            .select('id, name')
            .eq('id', firstAccepted!.institutionId)
            .maybeSingle();

        structuredLog('INFO', 'Institution member accepted their invite', requestId, {
            institutionId: firstAccepted!.institutionId,
            userId: authCheck.userId,
        });

        return NextResponse.json({
            success: true,
            alreadyAccepted: false,
            institution: {
                id: firstAccepted!.institutionId,
                name: (institution?.name as string | undefined) ?? null,
            },
            role: normalizeMemberRole(firstAccepted!.role),
        });
    } catch (error) {
        captureException(error, { context: 'acceptInvite', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to complete onboarding' },
            { status: 500 },
        );
    }
}
