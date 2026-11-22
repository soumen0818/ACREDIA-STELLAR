import type { User } from '@supabase/supabase-js';
import type { AppRole, RoleState } from '@/types';

/**
 * The session state `AuthProvider` exposes, and how it moves (issue #342).
 *
 * Kept free of React so the ordering rules can be tested directly:
 *
 * - `loading` stays true until the role of the current user is known. It used
 *   to drop as soon as the role lookup *started*, so for a moment a student
 *   on /admin had `loading: false, userRole: 'loading'`, and the admin console
 *   rendered and sent admin API requests.
 * - Only the latest lookup counts. `getSession()` and `onAuthStateChange`
 *   both report the session at mount, so two lookups run at once; a slow
 *   first one must not overwrite the second.
 * - A different user never inherits the previous user's role: switching
 *   users resets the role to `'loading'` until the new one is known. A
 *   same-user update (a token refresh) re-checks the role without flashing
 *   the page back to its loading state.
 */
export interface SessionState {
    user: User | null;
    userRole: RoleState;
    loading: boolean;
}

export const INITIAL_SESSION_STATE: SessionState = { user: null, userRole: 'loading', loading: true };

export interface RoleSession {
    /** Reports the session's user (or null when signed out) and resolves their role. */
    update(nextUser: User | null): Promise<void>;
    /** Signed out locally: no user, and any lookup still running is discarded. */
    clear(): void;
    /** The provider unmounted: nothing more is applied. */
    stop(): void;
}

export function createRoleSession(
    resolveRole: (user: User) => Promise<RoleState>,
    apply: (patch: Partial<SessionState>) => void,
): RoleSession {
    let sequence = 0;
    // `undefined` until the first report, so the first user always counts as a change.
    let currentUserId: string | null | undefined;
    let stopped = false;

    const clear = () => {
        sequence += 1;
        currentUserId = null;
        if (!stopped) apply({ user: null, userRole: 'unknown', loading: false });
    };

    return {
        async update(nextUser) {
            if (stopped) return;
            if (!nextUser) {
                clear();
                return;
            }

            const ticket = ++sequence;
            const changed = nextUser.id !== currentUserId;
            currentUserId = nextUser.id;
            apply(changed ? { user: nextUser, userRole: 'loading', loading: true } : { user: nextUser });

            let role: RoleState;
            try {
                role = await resolveRole(nextUser);
            } catch {
                // Keep the app usable if resolution fails: an unknown role is
                // let into no role-gated page.
                role = 'unknown';
            }

            if (stopped || ticket !== sequence) return;
            apply({ userRole: role, loading: false });
        },
        clear,
        stop() {
            stopped = true;
        },
    };
}

export type RouteGate = 'loading' | 'sign-in' | 'not-allowed' | 'render';

/**
 * What `ProtectedRoute` does for a session. A known user whose role is still
 * being looked up is loading, never "render": a role-gated page must not
 * mount before it is known to be allowed (issue #342).
 */
export function routeGate(state: SessionState, allowedRoles?: AppRole[]): RouteGate {
    if (state.loading) return 'loading';
    if (!state.user) return 'sign-in';
    if (state.userRole === 'loading') return 'loading';
    if (allowedRoles && !allowedRoles.includes(state.userRole as AppRole)) return 'not-allowed';
    return 'render';
}
