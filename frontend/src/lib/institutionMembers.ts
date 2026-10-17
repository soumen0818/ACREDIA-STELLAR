import type { SupabaseClient } from '@supabase/supabase-js';
import {
    assessContinuity,
    isInviteExpired,
    type ContinuityAssessment,
} from './institutionContinuity';
import { canWrite, normalizeMemberRole, type InstitutionRole, type MemberRole } from './institutionMembership';

/**
 * Self-service institution membership (Issue #307).
 *
 * An institution's owners invite, re-role and remove their own members, so an
 * institution never depends on one person or on an Acredia admin to add a
 * second. Two rules shape everything here:
 *
 *  - **Invitations go to the invitee's inbox, never to the inviter.** A link
 *    the inviting owner could open would let them set the invitee's password
 *    and stand up a "second member" that is really themselves — satisfying the
 *    continuity check while defeating its purpose.
 *  - **The last owner, and the last member who can issue, cannot be removed
 *    or demoted.** That is enforced by `change_institution_member()` in the
 *    database, inside one locked transaction, so two owners removing each
 *    other at once still cannot strand the institution.
 */

/** Matches the institution POC invite lifetime (Issue #240). */
export const MEMBER_INVITE_TTL_DAYS = 7;

/** Generous for a registrar's office; a bound on what one owner account can create. */
export const MAX_INSTITUTION_MEMBERS = 25;

export type MemberViewStatus = 'active' | 'invited' | 'expired';

export interface InstitutionMemberView {
    id: string;
    name: string | null;
    email: string | null;
    role: MemberRole;
    status: MemberViewStatus;
    isYou: boolean;
    invitedAt: string | null;
    inviteExpiresAt: string | null;
    acceptedAt: string | null;
}

export interface InstitutionTeam {
    members: InstitutionMemberView[];
    continuity: ContinuityAssessment;
}

interface MembershipRow {
    id: string;
    auth_user_id: string;
    role: InstitutionRole;
    status: string;
    invited_at: string | null;
    invite_expires_at: string | null;
    accepted_at: string | null;
    created_at: string | null;
}

const MEMBERSHIP_COLUMNS =
    'id, auth_user_id, role, status, invited_at, invite_expires_at, accepted_at, created_at';

export function inviteExpiryFrom(now: Date): string {
    return new Date(now.getTime() + MEMBER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The institution's current team — active members and outstanding invites —
 * with its continuity assessment. Removed members are left out; their history
 * lives in the audit log.
 */
export async function listInstitutionTeam(
    client: SupabaseClient,
    institutionId: string,
    viewerUserId: string | null,
    now: Date = new Date(),
): Promise<InstitutionTeam> {
    const { data, error } = await client
        .from('institution_users')
        .select(MEMBERSHIP_COLUMNS)
        .eq('institution_id', institutionId)
        .in('status', ['active', 'invited'])
        .order('created_at', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as MembershipRow[];
    const userIds = rows.map((row) => row.auth_user_id);
    const profiles = new Map<string, { full_name: string | null; email: string | null }>();

    if (userIds.length > 0) {
        const { data: profileRows, error: profileError } = await client
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);

        if (profileError) throw profileError;

        for (const profile of profileRows ?? []) {
            profiles.set(profile.id as string, {
                full_name: (profile.full_name as string | null) ?? null,
                email: (profile.email as string | null) ?? null,
            });
        }
    }

    const members: InstitutionMemberView[] = rows.map((row) => {
        const profile = profiles.get(row.auth_user_id);
        const status: MemberViewStatus =
            row.status === 'active'
                ? 'active'
                : isInviteExpired(row.invite_expires_at, now)
                  ? 'expired'
                  : 'invited';

        return {
            id: row.id,
            name: profile?.full_name ?? null,
            email: profile?.email ?? null,
            role: normalizeMemberRole(row.role),
            status,
            isYou: viewerUserId !== null && row.auth_user_id === viewerUserId,
            invitedAt: row.invited_at,
            inviteExpiresAt: row.invite_expires_at,
            acceptedAt: row.accepted_at,
        };
    });

    return {
        members,
        continuity: assessContinuity(
            rows.map((row) => ({
                role: row.role,
                status: row.status,
                inviteExpiresAt: row.invite_expires_at,
            })),
            now,
        ),
    };
}

// ---------------------------------------------------------------------------
// Guarded changes
// ---------------------------------------------------------------------------

export type MemberChangeErrorCode = 'last_owner' | 'last_issuer' | 'member_not_found' | 'invalid_role';

const MEMBER_CHANGE_ERRORS: Record<MemberChangeErrorCode, { status: number; message: string }> = {
    last_owner: {
        status: 409,
        message:
            'This is the only owner. Make another active member an owner first, so someone can still manage the team.',
    },
    last_issuer: {
        status: 409,
        message:
            'This is the only member who can issue credentials. Give another active member issuing rights first.',
    },
    member_not_found: { status: 404, message: 'That member is not part of this institution.' },
    invalid_role: { status: 400, message: 'Role must be owner, issuer or viewer.' },
};

export class MemberChangeError extends Error {
    readonly status: number;

    constructor(readonly code: MemberChangeErrorCode) {
        super(MEMBER_CHANGE_ERRORS[code].message);
        this.name = 'MemberChangeError';
        this.status = MEMBER_CHANGE_ERRORS[code].status;
    }
}

/** Maps the database guard's exceptions to typed errors; anything else is rethrown. */
function toMemberChangeError(error: { message?: string } | null): MemberChangeError | null {
    const message = error?.message ?? '';
    for (const code of Object.keys(MEMBER_CHANGE_ERRORS) as MemberChangeErrorCode[]) {
        if (message.includes(code)) return new MemberChangeError(code);
    }
    return null;
}

export interface MemberChangeResult {
    id: string;
    authUserId: string;
    role: InstitutionRole;
    status: string;
}

/**
 * Removes or re-roles a member through the database guard. Throws
 * {@link MemberChangeError} when the change would strand the institution.
 */
export async function changeInstitutionMember(
    client: SupabaseClient,
    args: {
        institutionId: string;
        memberId: string;
        action: 'remove' | 'set_role';
        role?: MemberRole;
        actorId: string;
    },
): Promise<MemberChangeResult> {
    const { data, error } = await client.rpc('change_institution_member', {
        p_institution_id: args.institutionId,
        p_member_id: args.memberId,
        p_action: args.action,
        p_new_role: args.action === 'set_role' ? (args.role ?? null) : null,
        p_actor_id: args.actorId,
    });

    if (error) {
        throw toMemberChangeError(error) ?? error;
    }

    const row = (Array.isArray(data) ? data[0] : data) as
        | { id: string; auth_user_id: string; role: InstitutionRole; status: string }
        | null;

    if (!row) {
        throw new MemberChangeError('member_not_found');
    }

    return { id: row.id, authUserId: row.auth_user_id, role: row.role, status: row.status };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InviteErrorCode =
    | 'self_invite'
    | 'already_member'
    | 'already_invited'
    | 'email_in_use'
    | 'team_full'
    | 'delivery_failed';

const INVITE_ERRORS: Record<InviteErrorCode, { status: number; message: string }> = {
    self_invite: { status: 400, message: 'You are already a member.' },
    already_member: { status: 409, message: 'This person is already an active member.' },
    already_invited: {
        status: 409,
        message: 'This person already has a pending invitation. Use "Resend" to send it again.',
    },
    email_in_use: {
        status: 409,
        message:
            'This email address is already used by another Acredia account, so it cannot be invited here. Use the address they will use for this institution, or contact Acredia support.',
    },
    team_full: {
        status: 409,
        message: `An institution can have at most ${MAX_INSTITUTION_MEMBERS} members and pending invitations.`,
    },
    delivery_failed: {
        status: 502,
        message:
            'The invitation email could not be sent. Nothing was lost — try again in a few minutes. If it keeps failing, Acredia support can send the invitation for you.',
    },
};

export class MemberInviteError extends Error {
    readonly status: number;

    constructor(readonly code: InviteErrorCode) {
        super(INVITE_ERRORS[code].message);
        this.name = 'MemberInviteError';
        this.status = INVITE_ERRORS[code].status;
    }
}

export interface InviteMemberInput {
    institutionId: string;
    inviterId: string;
    inviterEmail: string | null;
    email: string;
    name: string;
    role: MemberRole;
    /** Where the emailed link lands — the accept-invite page. */
    redirectTo: string;
    now?: Date;
}

export interface InviteMemberResult {
    memberId: string;
    authUserId: string;
    /** True when a former member was re-invited rather than a new account created. */
    reinvited: boolean;
    inviteExpiresAt: string;
}

function isAlreadyRegistered(error: { message?: string } | null): boolean {
    return /already (been )?registered|already exists/i.test(error?.message ?? '');
}

/**
 * Emails an invitation link to the invitee.
 *
 * New accounts get Supabase's invite email. An account that already exists —
 * a former member being re-invited, or a resend after the first invite was
 * accepted on the auth side but not here — gets a password-reset email to the
 * same landing page, which the accept-invite flow also handles.
 */
async function deliverInvitation(
    client: SupabaseClient,
    email: string,
    redirectTo: string,
    metadata: Record<string, unknown>,
): Promise<{ userId: string | null; existing: boolean }> {
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: metadata,
    });

    if (!error) {
        return { userId: data.user?.id ?? null, existing: false };
    }

    if (!isAlreadyRegistered(error)) {
        throw new MemberInviteError('delivery_failed');
    }

    const { error: resetError } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (resetError) {
        throw new MemberInviteError('delivery_failed');
    }

    return { userId: null, existing: true };
}

export async function inviteInstitutionMember(
    client: SupabaseClient,
    input: InviteMemberInput,
): Promise<InviteMemberResult> {
    const now = input.now ?? new Date();
    const email = input.email.trim().toLowerCase();

    if (input.inviterEmail && email === input.inviterEmail.trim().toLowerCase()) {
        throw new MemberInviteError('self_invite');
    }

    const { count, error: countError } = await client
        .from('institution_users')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', input.institutionId)
        .in('status', ['active', 'invited']);

    if (countError) throw countError;
    if ((count ?? 0) >= MAX_INSTITUTION_MEMBERS) {
        throw new MemberInviteError('team_full');
    }

    const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id, role')
        .eq('email', email)
        .maybeSingle();

    if (profileError) throw profileError;

    const invitedAt = now.toISOString();
    const inviteExpiresAt = inviteExpiryFrom(now);
    const membershipFields = {
        role: input.role,
        status: 'invited',
        invited_by: input.inviterId,
        invited_at: invitedAt,
        invite_expires_at: inviteExpiresAt,
        accepted_at: null,
        removed_at: null,
        removed_by: null,
    };

    // An existing account may only be re-invited if it is a former member of
    // this institution. Anything else — a student, an admin, a member of
    // another institution — is refused with one generic message, so an owner
    // learns nothing about what kind of account it is.
    if (profile?.id) {
        const { data: existing, error: existingError } = await client
            .from('institution_users')
            .select('id, status')
            .eq('institution_id', input.institutionId)
            .eq('auth_user_id', profile.id)
            .maybeSingle();

        if (existingError) throw existingError;
        if (!existing) throw new MemberInviteError('email_in_use');
        if (existing.status === 'active') throw new MemberInviteError('already_member');
        if (existing.status === 'invited') throw new MemberInviteError('already_invited');

        // Reopen the membership before the email goes out, so the link never
        // lands on a membership that is still closed; close it again if the
        // email cannot be sent.
        const { error: updateError } = await client
            .from('institution_users')
            .update(membershipFields)
            .eq('id', existing.id)
            .eq('status', 'deactivated');

        if (updateError) throw updateError;

        try {
            await deliverInvitation(client, email, input.redirectTo, {
                name: input.name,
                role: 'institution',
            });
        } catch (deliveryError) {
            await client
                .from('institution_users')
                .update({ status: 'deactivated' })
                .eq('id', existing.id)
                .eq('status', 'invited');
            throw deliveryError;
        }

        return {
            memberId: existing.id as string,
            authUserId: profile.id as string,
            reinvited: true,
            inviteExpiresAt,
        };
    }

    const delivery = await deliverInvitation(client, email, input.redirectTo, {
        name: input.name,
        role: 'institution',
    });

    // An auth account with no profile is not something an owner can claim.
    if (delivery.existing || !delivery.userId) {
        throw new MemberInviteError('email_in_use');
    }

    const { error: upsertProfileError } = await client.from('profiles').upsert(
        {
            id: delivery.userId,
            email,
            role: 'institution',
            full_name: input.name,
            is_active: true,
        },
        { onConflict: 'id' },
    );

    if (upsertProfileError) throw upsertProfileError;

    const { data: membership, error: insertError } = await client
        .from('institution_users')
        .insert({
            institution_id: input.institutionId,
            auth_user_id: delivery.userId,
            ...membershipFields,
        })
        .select('id')
        .single();

    if (insertError || !membership) throw insertError ?? new Error('Membership insert returned no row');

    return {
        memberId: membership.id as string,
        authUserId: delivery.userId,
        reinvited: false,
        inviteExpiresAt,
    };
}

export type ResendErrorCode = 'member_not_found' | 'not_pending';

export class MemberResendError extends Error {
    readonly status: number;

    constructor(readonly code: ResendErrorCode) {
        super(
            code === 'not_pending'
                ? 'Only a pending invitation can be resent.'
                : 'That member is not part of this institution.',
        );
        this.name = 'MemberResendError';
        this.status = code === 'not_pending' ? 409 : 404;
    }
}

/** Re-sends a pending (or expired) invitation and restarts its window. */
export async function resendMemberInvitation(
    client: SupabaseClient,
    args: { institutionId: string; memberId: string; redirectTo: string; now?: Date },
): Promise<{ email: string; inviteExpiresAt: string; authUserId: string }> {
    const now = args.now ?? new Date();

    const { data: membership, error } = await client
        .from('institution_users')
        .select('id, auth_user_id, status')
        .eq('id', args.memberId)
        .eq('institution_id', args.institutionId)
        .maybeSingle();

    if (error) throw error;
    if (!membership) throw new MemberResendError('member_not_found');
    if (membership.status !== 'invited') throw new MemberResendError('not_pending');

    const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('email, full_name')
        .eq('id', membership.auth_user_id)
        .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.email) throw new MemberResendError('member_not_found');

    await deliverInvitation(client, profile.email as string, args.redirectTo, {
        name: profile.full_name ?? undefined,
        role: 'institution',
    });

    const inviteExpiresAt = inviteExpiryFrom(now);
    const { error: updateError } = await client
        .from('institution_users')
        .update({ invited_at: now.toISOString(), invite_expires_at: inviteExpiresAt })
        .eq('id', membership.id)
        .eq('status', 'invited');

    if (updateError) throw updateError;

    return {
        email: profile.email as string,
        inviteExpiresAt,
        authUserId: membership.auth_user_id as string,
    };
}

// ---------------------------------------------------------------------------
// Erasure impact
// ---------------------------------------------------------------------------

export interface InstitutionLeftWithoutIssuer {
    institutionId: string;
    name: string | null;
}

/**
 * Institutions where `userId` is the last active member able to issue — the
 * ones that stop issuing if this user's account goes away.
 */
export async function institutionsLeftWithoutIssuer(
    client: SupabaseClient,
    userId: string,
): Promise<InstitutionLeftWithoutIssuer[]> {
    const { data: own, error } = await client
        .from('institution_users')
        .select('institution_id, role')
        .eq('auth_user_id', userId)
        .eq('status', 'active');

    if (error) throw error;

    const affected: InstitutionLeftWithoutIssuer[] = [];

    for (const membership of own ?? []) {
        if (!canWrite(membership.role as InstitutionRole)) continue;

        const { data: others, error: othersError } = await client
            .from('institution_users')
            .select('role')
            .eq('institution_id', membership.institution_id)
            .eq('status', 'active')
            .neq('auth_user_id', userId);

        if (othersError) throw othersError;

        const otherIssuers = (others ?? []).filter((row) => canWrite(row.role as InstitutionRole));
        if (otherIssuers.length > 0) continue;

        const { data: institution } = await client
            .from('institutions')
            .select('name')
            .eq('id', membership.institution_id)
            .maybeSingle();

        affected.push({
            institutionId: membership.institution_id as string,
            name: (institution?.name as string | undefined) ?? null,
        });
    }

    return affected;
}
