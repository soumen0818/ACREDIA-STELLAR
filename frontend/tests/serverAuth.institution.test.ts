import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type SupabaseMockState = {
    tokenUserId?: string;
    /** Row returned from `profiles` for the caller, if any. */
    profileRole?: string;
    /** Row returned from `institutions` for the caller, if any. */
    institutionId?: string;
    /** Whether a `students` row exists for the caller. */
    hasStudentRow?: boolean;
};

const state: SupabaseMockState = {};

/** Records which client each query ran through, to prove the fallback path. */
const queriedTables: Array<{ key: string; table: string }> = [];

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn((_url: string, key: string) => ({
        auth: {
            getUser: vi.fn(async () => ({
                data: state.tokenUserId ? { user: { id: state.tokenUserId } } : { user: null },
                error: state.tokenUserId ? null : new Error('Invalid token'),
            })),
        },
        from: vi.fn((table: string) => {
            queriedTables.push({ key, table });

            // Chainable stub: the membership resolver strings together
            // select/eq/eq/order/limit before resolving, so every builder
            // method has to return the builder itself.
            const resolve = async () => {
                if (table === 'profiles') {
                    return {
                        data: state.profileRole ? { role: state.profileRole } : null,
                        error: null,
                    };
                }
                if (table === 'institution_users') {
                    return {
                        data: state.institutionId
                            ? {
                                  institution_id: state.institutionId,
                                  role: 'owner',
                                  status: 'active',
                              }
                            : null,
                        error: null,
                    };
                }
                if (table === 'institutions') {
                    return {
                        data: state.institutionId ? { id: state.institutionId } : null,
                        error: null,
                    };
                }
                if (table === 'students') {
                    return {
                        data: state.hasStudentRow ? { id: 'student-1' } : null,
                        error: null,
                    };
                }
                return { data: null, error: null };
            };

            const builder: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
                builder[method] = vi.fn(() => builder);
            }
            builder.maybeSingle = vi.fn(resolve);
            builder.single = vi.fn(resolve);

            return builder;
        }),
    })),
}));

async function loadGuard({ serviceRole = true }: { serviceRole?: boolean } = {}) {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    if (serviceRole) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    } else {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }

    const mod = await import('../src/lib/serverAuth');
    return mod.requireInstitutionRequest;
}

function request(headers: Record<string, string> = {}): NextRequest {
    return { headers: new Headers(headers) } as NextRequest;
}

function authorizedRequest(): NextRequest {
    return request({ authorization: 'Bearer valid-token' });
}

describe('requireInstitutionRequest', () => {
    beforeEach(() => {
        queriedTables.length = 0;
        Object.assign(state, {
            tokenUserId: undefined,
            profileRole: undefined,
            institutionId: undefined,
            hasStudentRow: false,
        });
    });

    it('rejects a request with no Authorization header', async () => {
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(request())).resolves.toEqual({
            ok: false,
            status: 401,
            error: 'Missing access token',
        });
    });

    it('rejects a request with an unverifiable token', async () => {
        state.tokenUserId = undefined;
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toEqual({
            ok: false,
            status: 401,
            error: 'Invalid or expired access token',
        });
    });

    it('rejects a student, identified by a students row', async () => {
        Object.assign(state, { tokenUserId: 'student-user', hasStudentRow: true });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toEqual({
            ok: false,
            status: 403,
            error: 'Institution access required',
        });
    });

    it('rejects a student, identified by profiles.role', async () => {
        Object.assign(state, { tokenUserId: 'student-user', profileRole: 'student' });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('rejects an admin — admins are not issuers', async () => {
        Object.assign(state, { tokenUserId: 'admin-user', profileRole: 'admin' });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('rejects an unprovisioned user with no role rows at all', async () => {
        state.tokenUserId = 'new-user';
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('honours profiles.role over a stale institutions row', async () => {
        // profiles.role is the documented source of truth; a leftover
        // institutions row must not re-grant issuer access.
        Object.assign(state, {
            tokenUserId: 'demoted-user',
            profileRole: 'student',
            institutionId: 'institution-1',
        });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('allows an institution and returns its institution id', async () => {
        Object.assign(state, { tokenUserId: 'institution-user', institutionId: 'institution-1' });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toEqual({
            ok: true,
            userId: 'institution-user',
            institutionId: 'institution-1',
            memberRole: 'owner',
        });
    });

    it('allows an institution whose role comes from profiles without an institutions row', async () => {
        Object.assign(state, { tokenUserId: 'institution-user', profileRole: 'institution' });
        const requireInstitutionRequest = await loadGuard();

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toEqual({
            ok: true,
            userId: 'institution-user',
            institutionId: null,
            memberRole: null,
        });
    });

    it('falls back to a token-scoped client when no service role key is configured', async () => {
        Object.assign(state, { tokenUserId: 'institution-user', institutionId: 'institution-1' });
        const requireInstitutionRequest = await loadGuard({ serviceRole: false });

        await expect(requireInstitutionRequest(authorizedRequest())).resolves.toMatchObject({
            ok: true,
            userId: 'institution-user',
        });
        // Every role query ran through the anon (user-scoped) key, never a
        // service-role key that is not configured here.
        expect(queriedTables.length).toBeGreaterThan(0);
        expect(queriedTables.every((entry) => entry.key === 'anon-key')).toBe(true);
    });
});
