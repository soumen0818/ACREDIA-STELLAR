import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
    createRoleSession,
    INITIAL_SESSION_STATE,
    routeGate,
    type SessionState,
} from '../src/lib/authSession';
import type { RoleState } from '../src/types';

/**
 * Issue #342: AuthProvider dropped `loading` as soon as the role lookup
 * started, so a student opening /admin briefly got the admin console.
 */

const user = (id: string) => ({ id, email: `${id}@test` }) as unknown as User;

/** A role lookup whose answers the test releases by hand, in any order. */
function controllableResolver() {
    const pending: Array<{ user: User; resolve: (role: RoleState) => void; reject: (error: Error) => void }> = [];
    const resolveRole = vi.fn(
        (forUser: User) =>
            new Promise<RoleState>((resolve, reject) => {
                pending.push({ user: forUser, resolve, reject });
            }),
    );
    return { resolveRole, pending };
}

function harness() {
    const { resolveRole, pending } = controllableResolver();
    let state: SessionState = { ...INITIAL_SESSION_STATE };
    const history: SessionState[] = [];
    const session = createRoleSession(resolveRole, (patch) => {
        state = { ...state, ...patch };
        history.push(state);
    });
    return { session, pending, resolveRole, history, state: () => state };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRoleSession', () => {
    it('stays loading until the role is known (the #342 bug)', async () => {
        const h = harness();
        const done = h.session.update(user('student'));

        // The lookup has started but not answered: never "loaded, role loading".
        expect(h.state()).toMatchObject({ loading: true, userRole: 'loading' });

        h.pending[0].resolve('student');
        await done;
        expect(h.state()).toMatchObject({ loading: false, userRole: 'student' });
        // No intermediate state had loading off with the role unknown.
        expect(h.history.some((s) => !s.loading && s.userRole === 'loading')).toBe(false);
    });

    it('applies only the latest lookup when two run at once', async () => {
        const h = harness();
        // getSession() and onAuthStateChange both report the same user at mount.
        const first = h.session.update(user('u1'));
        const second = h.session.update(user('u1'));

        h.pending[1].resolve('student');
        await second;
        // The first, slower lookup answers late with an outdated role.
        h.pending[0].resolve('admin');
        await first;

        expect(h.state()).toMatchObject({ loading: false, userRole: 'student' });
    });

    it('never gives a new user the previous user’s role', async () => {
        const h = harness();
        const asAdmin = h.session.update(user('admin-user'));
        h.pending[0].resolve('admin');
        await asAdmin;

        const asStudent = h.session.update(user('student-user'));
        // Before the new lookup answers, the old 'admin' role is gone.
        expect(h.state()).toMatchObject({ loading: true, userRole: 'loading' });
        expect(h.state().user?.id).toBe('student-user');

        h.pending[1].resolve('student');
        await asStudent;
        expect(h.state()).toMatchObject({ loading: false, userRole: 'student' });
    });

    it('re-checks the role on a same-user update without flashing back to loading', async () => {
        const h = harness();
        const first = h.session.update(user('u1'));
        h.pending[0].resolve('institution');
        await first;

        const refresh = h.session.update(user('u1')); // e.g. TOKEN_REFRESHED
        expect(h.state()).toMatchObject({ loading: false, userRole: 'institution' });

        h.pending[1].resolve('institution');
        await refresh;
        expect(h.state()).toMatchObject({ loading: false, userRole: 'institution' });
    });

    it('answers a signed-out session at once, with no lookup', async () => {
        const h = harness();
        await h.session.update(null);
        expect(h.state()).toMatchObject({ user: null, loading: false, userRole: 'unknown' });
        expect(h.resolveRole).not.toHaveBeenCalled();
    });

    it('falls back to an unknown role when the lookup fails', async () => {
        const h = harness();
        const done = h.session.update(user('u1'));
        h.pending[0].reject(new Error('network'));
        await done;
        expect(h.state()).toMatchObject({ loading: false, userRole: 'unknown' });
    });

    it('discards a lookup still running when the user signs out', async () => {
        const h = harness();
        const done = h.session.update(user('u1'));
        h.session.clear();
        h.pending[0].resolve('admin');
        await done;
        expect(h.state()).toMatchObject({ user: null, loading: false, userRole: 'unknown' });
    });

    it('applies nothing after the provider unmounts', async () => {
        const h = harness();
        const done = h.session.update(user('u1'));
        const applied = h.history.length;
        h.session.stop();
        h.pending[0].resolve('admin');
        await done;
        await h.session.update(user('u2'));
        await flush();
        expect(h.history.length).toBe(applied);
    });
});

describe('routeGate', () => {
    const student = { user: user('s'), loading: false, userRole: 'student' as RoleState };

    it('treats a known user with an unknown-yet role as loading, never as allowed', () => {
        expect(routeGate({ ...student, userRole: 'loading' }, ['admin'])).toBe('loading');
        expect(routeGate({ ...student, userRole: 'loading' })).toBe('loading');
    });

    it('loads while the session itself is loading', () => {
        expect(routeGate({ ...student, loading: true }, ['admin'])).toBe('loading');
    });

    it('sends a signed-out visitor to sign in', () => {
        expect(routeGate({ user: null, loading: false, userRole: 'unknown' }, ['admin'])).toBe('sign-in');
    });

    it('refuses a role outside the allowed list, including unknown and unprovisioned', () => {
        expect(routeGate(student, ['admin'])).toBe('not-allowed');
        expect(routeGate({ ...student, userRole: 'unknown' }, ['admin'])).toBe('not-allowed');
        expect(routeGate({ ...student, userRole: 'unprovisioned' }, ['institution'])).toBe('not-allowed');
    });

    it('renders an allowed role, and any role when none is required', () => {
        expect(routeGate({ ...student, userRole: 'admin' }, ['admin'])).toBe('render');
        expect(routeGate(student)).toBe('render');
    });
});
