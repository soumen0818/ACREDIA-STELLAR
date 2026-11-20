import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Membership roles within an institution.
 *
 * `owner`/`issuer`/`viewer` are the vocabulary this codebase writes going
 * forward. `poc`/`admin`/`member` are the legacy values written by the POC
 * handover and provisioning routes; they are read here so a legacy row never
 * silently loses access, and they map onto the same three capability levels.
 */
export type InstitutionRole = 'owner' | 'issuer' | 'viewer' | 'admin' | 'member' | 'poc';

export type MembershipStatus = 'invited' | 'active' | 'deactivated';

export interface InstitutionMembership {
    institutionId: string;
    role: InstitutionRole;
    status: MembershipStatus;
}

/** Roles permitted to issue, revoke, and change institution settings. */
const WRITE_ROLES: ReadonlySet<InstitutionRole> = new Set<InstitutionRole>([
    'owner',
    'issuer',
    'admin',
    'poc',
]);

/** Roles permitted to manage the institution's members. */
const MEMBER_MANAGEMENT_ROLES: ReadonlySet<InstitutionRole> = new Set<InstitutionRole>([
    'owner',
    'poc',
]);

/**
 * Whether the role may issue or revoke credentials, rotate API keys, or change
 * institution settings such as the linked wallet. `viewer` and `member` are
 * read-only and are rejected.
 */
export function canWrite(role: InstitutionRole): boolean {
    return WRITE_ROLES.has(role);
}

/** Whether the role may add, remove, or re-role other members. */
export function canManageMembers(role: InstitutionRole): boolean {
    return MEMBER_MANAGEMENT_ROLES.has(role);
}

/** The three roles members see and assign; legacy values map onto them. */
export type MemberRole = 'owner' | 'issuer' | 'viewer';

/** Maps a stored role, including the legacy vocabulary, to what a member sees. */
export function normalizeMemberRole(role: InstitutionRole | string | null | undefined): MemberRole {
    if (role === 'owner' || role === 'poc') return 'owner';
    if (role === 'issuer' || role === 'admin') return 'issuer';
    return 'viewer';
}

/**
 * Resolves which institution a user acts for, and with what role.
 *
 * This is the single place institution ownership is resolved. Before Issue
 * #238 every call site repeated `.eq('auth_user_id', userId)` against
 * `institutions`, which hard-coded one login per institution into ~10 queries;
 * routing them all through here is what makes a second member possible without
 * another rewrite.
 *
 * Only `active` memberships resolve — an `invited` member has not accepted yet
 * and a `deactivated` one has been offboarded, so neither may act.
 *
 * The deprecated `institutions.auth_user_id` column is no longer consulted
 * (Issue #308). All memberships must exist in `institution_users`.
 */
export async function resolveInstitutionForUser(
    client: SupabaseClient,
    userId: string,
): Promise<InstitutionMembership | null> {
    const { data: membership, error } = await client
        .from('institution_users')
        .select('institution_id, role, status')
        .eq('auth_user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!membership?.institution_id) {
        return null;
    }

    return {
        institutionId: membership.institution_id as string,
        role: (membership.role as InstitutionRole) ?? 'issuer',
        status: (membership.status as MembershipStatus) ?? 'active',
    };
}

/**
 * Resolves the caller's institution id, or `null` when they are not an active
 * member of one. For callers that need the id but not the role.
 */
export async function resolveInstitutionIdForUser(
    client: SupabaseClient,
    userId: string,
): Promise<string | null> {
    const membership = await resolveInstitutionForUser(client, userId);
    return membership?.institutionId ?? null;
}

/**
 * Whether a user is an active member of one specific institution.
 *
 * Asks the membership table directly rather than comparing against
 * {@link resolveInstitutionForUser}, which returns only the first membership —
 * once a user can belong to several institutions, comparing ids would wrongly
 * deny access to every institution but one.
 */
export async function isMemberOfInstitution(
    client: SupabaseClient,
    userId: string,
    institutionId: string,
): Promise<boolean> {
    const { data, error } = await client
        .from('institution_users')
        .select('institution_id')
        .eq('auth_user_id', userId)
        .eq('institution_id', institutionId)
        .eq('status', 'active')
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data?.institution_id);
}

/**
 * Resolves the auth user to notify on behalf of an institution — its owner.
 *
 * Returns the `auth_user_id` of the first active owner membership, or `null`
 * when no owner membership exists.
 */
export async function resolveInstitutionOwnerId(
    client: SupabaseClient,
    institutionId: string,
): Promise<string | null> {
    const { data } = await client
        .from('institution_users')
        .select('auth_user_id, role')
        .eq('institution_id', institutionId)
        .eq('status', 'active')
        .in('role', ['owner', 'poc'])
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    return (data?.auth_user_id as string | undefined) ?? null;
}
