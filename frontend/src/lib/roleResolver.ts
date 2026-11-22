/**
 * Centralized role resolution for Acredia.
 *
 * This module is the **single source of truth** for mapping a Supabase user to
 * an application role.  Both client-side (AuthContext) and server-side
 * (serverAuth) callers share this logic, ensuring contributors never need to
 * guess which function to use.
 *
 * ## Resolution priority (stops at first match)
 * 1. `profiles.role` — the DB-backed source of truth (set by trusted processes)
 * 2. institution membership — an active `institution_users` row → `'institution'`
 * 3. `students` table — existence of a row → `'student'`
 * 4. Default → `'unprovisioned'` for a signed-in user, `'unknown'` with no user
 *
 * There is no self-asserted metadata tier: public signup was removed in Issue
 * #239, so a role is only ever set by whoever provisioned the account.
 *
 * @see {@link file://./../../../docs/auth-flow.md} for contributor documentation
 * @module
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import type { AppRole, RoleState } from '@/types';
import { getE2eState } from './e2e';
import { resolveInstitutionIdForUser } from './institutionMembership';
// ---------------------------------------------------------------------------
// Core resolver (works with any Supabase client — browser or server)
// ---------------------------------------------------------------------------

/**
 * Resolve the application role for a given user.
 *
 * @param client  A Supabase client instance (browser singleton or server-scoped)
 * @param user    The authenticated Supabase user, or `null` if signed out
 * @returns       A resolved `AppRole` or `'unknown'` if no role data was found
 */
export async function resolveUserRole(
    client: SupabaseClient,
    user: User | null,
): Promise<AppRole | 'unprovisioned' | 'unknown'> {
    if (!user) {
        return 'unknown';
    }

    // 1. Profiles table — DB-backed source of truth
    const profileRole = await resolveFromProfiles(client, user.id);
    if (profileRole) {
        return profileRole;
    }

    // 2. Institutions table — existence check
    const isInstitution = await hasRowIn(client, 'institutions', user.id);
    if (isInstitution) {
        return 'institution';
    }

    // 3. Students table — existence check
    const isStudent = await hasRowIn(client, 'students', user.id);
    if (isStudent) {
        return 'student';
    }

    // 4. Nothing matched - role not provisioned
    return 'unprovisioned';
}

// ---------------------------------------------------------------------------
// Client-side convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Client-side role resolver.  Wraps {@link resolveUserRole} with the browser
 * Supabase singleton.  Designed to be called from `AuthContext`.
 */
export async function resolveUserRoleClient(
    client: SupabaseClient,
    user: User | null,
): Promise<RoleState> {
    const e2eState = getE2eState();
    if (e2eState?.enabled && (e2eState.role || e2eState.session)) {
        // Asynchronous like the real lookup, so E2E sessions go through the
        // same ordering in AuthProvider (issue #342).
        if (e2eState.roleResolutionDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, e2eState.roleResolutionDelayMs));
        }
        return e2eState.role ?? 'unknown';
    }

    return resolveUserRole(client, user);
}

// ---------------------------------------------------------------------------
// Server-side convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Server-side role resolver.  Accepts an explicit Supabase client (service-role
 * or user-scoped) so API routes stay in control of their client lifecycle.
 */
export async function resolveUserRoleServer(
    client: SupabaseClient,
    userId: string,
): Promise<AppRole | 'unprovisioned' | 'unknown'> {
    // Create a minimal User-like object for the shared resolver
    const { data: authData } = await client.auth.admin.getUserById(userId);
    const user = authData?.user ?? null;

    if (!user) {
        return 'unknown';
    }

    return resolveUserRole(client, user);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_PROFILE_ROLES: ReadonlySet<AppRole> = new Set(['admin', 'institution', 'student']);

/**
 * Check `profiles.role` for a recognised application role.
 */
async function resolveFromProfiles(
    client: SupabaseClient,
    userId: string,
): Promise<AppRole | null> {
    const { data: profile } = await client
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

    const role = profile?.role as string | undefined;

    if (role && VALID_PROFILE_ROLES.has(role as AppRole)) {
        return role as AppRole;
    }

    return null;
}

/**
 * Check whether a row exists in the given table for the user.
 */
async function hasRowIn(
    client: SupabaseClient,
    table: 'institutions' | 'students',
    userId: string,
): Promise<boolean> {
    // Institution affiliation lives in the membership table since Issue #238;
    // `students` still carries the user column directly.
    if (table === 'institutions') {
        return (await resolveInstitutionIdForUser(client, userId)) !== null;
    }

    const { data } = await client.from(table).select('id').eq('auth_user_id', userId).maybeSingle();

    return !!data?.id;
}
