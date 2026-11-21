import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type MockDbState = {
    // No auth_user_id: the column was dropped (#308); the POC is a membership row.
    institution: { id: string; name: string; email: string } | null;
    /** The POC's pending owner membership, or null. */
    pendingOwner: { auth_user_id: string } | null;
    /** Makes the pending-owner lookup fail. */
    ownerLookupError: { message: string } | null;
    /** Every `institution_users` update, with its filters. */
    membershipUpdates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>;
    auditLogs: Array<Record<string, unknown>>;
    authUserEmail: string;
    profileRole: string;
};

const state: MockDbState = {
    institution: {
        id: '22222222-2222-4222-a222-222222222222',
        name: 'Cambridge University',
        email: 'poc@cambridge.edu',
    },
    pendingOwner: { auth_user_id: 'user-cambridge-poc' },
    ownerLookupError: null,
    membershipUpdates: [],
    auditLogs: [],
    authUserEmail: 'admin@example.com',
    profileRole: 'admin',
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn((_url: string, key: string) => {
        if (key === 'anon-key') {
            return {
                auth: {
                    getUser: vi.fn(async () => ({
                        data: { user: { id: 'admin-user-id' } },
                        error: null,
                    })),
                },
            };
        }

        return {
            auth: {
                admin: {
                    getUserById: vi.fn(async () => ({
                        // `requireAdminRequest` forwards this whole user object
                        // into `resolveUserRole`, which looks up
                        // profiles.id — so `id` must be present, not just email.
                        data: { user: { id: 'admin-user-id', email: state.authUserEmail } },
                        error: null,
                    })),
                    generateLink: vi.fn(async ({ type, email: _email }: { type: string; email: string }) => ({
                        data: {
                            properties: {
                                action_link: `https://example.supabase.co/auth/v1/verify?token=single-use-${type}&type=${type}&redirect_to=http://localhost:3000/auth/reset-password`,
                            },
                        },
                        error: null,
                    })),
                },
            },
            from: vi.fn((tableName: string) => ({
                // `resolveInstitutionForUser()` chains up to three `.eq()` calls
                // plus `.order()` and `.limit()`, so every builder method must
                // return the chain itself. The previous mock had `.eq()` return
                // a bare `{ maybeSingle }`, which made the second `.eq()` throw
                // "is not a function" and surfaced as a 500.
                select: vi.fn(() => {
                    const filters: Array<[string, string]> = [];
                    const matched = (col: string, val: string) =>
                        filters.some(([c, v]) => c === col && v === val);

                    const resolve = async () => {
                        if (tableName === 'profiles' && matched('id', 'admin-user-id')) {
                            return { data: { role: state.profileRole }, error: null };
                        }
                        // The POC's pending owner membership (#308: the
                        // institutions.auth_user_id column is gone).
                        if (tableName === 'institution_users') {
                            return state.ownerLookupError
                                ? { data: null, error: state.ownerLookupError }
                                : { data: state.pendingOwner, error: null };
                        }
                        if (tableName === 'institutions') {
                            return { data: state.institution, error: null };
                        }
                        return { data: null, error: null };
                    };

                    const chain: Record<string, unknown> = {
                        eq: vi.fn((col: string, val: string) => {
                            filters.push([col, val]);
                            return chain;
                        }),
                        in: vi.fn(() => chain),
                        order: vi.fn(() => chain),
                        limit: vi.fn(() => chain),
                        maybeSingle: vi.fn(resolve),
                        single: vi.fn(resolve),
                    };
                    return chain;
                }),
                insert: vi.fn(async (data: Record<string, unknown>) => {
                    if (tableName === 'admin_audit_logs') {
                        state.auditLogs.push(data);
                    }
                    return { error: null };
                }),
                // The invite path advances `institutions.invited_at` after the
                // link is generated, so `update(...).eq(...)` must resolve.
                // Chainable and awaitable at any depth, like the real
                // builder: `update(...).eq(...).eq(...)` resolves too.
                update: vi.fn((values: Record<string, unknown>) => {
                    const filters: Array<[string, unknown]> = [];
                    if (tableName === 'institution_users') state.membershipUpdates.push({ values, filters });
                    const chain: Record<string, unknown> = {
                        then: (resolve: (value: unknown) => void) =>
                            resolve({ data: null, error: null }),
                    };
                    chain.eq = vi.fn((col: string, val: unknown) => {
                        filters.push([col, val]);
                        return chain;
                    });
                    return chain;
                }),
            })),
        };
    }),
}));

describe('POST /api/admin/institutions/[id]/recovery-link', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
        process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';

        state.institution = {
            id: '22222222-2222-4222-a222-222222222222',
            name: 'Cambridge University',
            email: 'poc@cambridge.edu',
        };
        state.pendingOwner = { auth_user_id: 'user-cambridge-poc' };
        state.ownerLookupError = null;
        state.membershipUpdates = [];
        state.auditLogs = [];
    });

    it('generates a single-use recovery link and creates an audit record', async () => {
        const { POST } = await import(
            '../src/app/api/admin/institutions/[id]/recovery-link/route'
        );

        const request = new NextRequest(
            'http://localhost:3000/api/admin/institutions/22222222-2222-4222-a222-222222222222/recovery-link',
            {
                method: 'POST',
                headers: new Headers({
                    authorization: 'Bearer valid-admin-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({
                    type: 'recovery',
                    reason: 'University firewall blocked reset email',
                }),
            },
        );

        const response = await POST(request, {
            params: Promise.resolve({ id: '22222222-2222-4222-a222-222222222222' }),
        });

        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.link).toContain('single-use-recovery');
        expect(json.expiresInHours).toBe(24);

        expect(state.auditLogs.length).toBe(1);
        expect(state.auditLogs[0]).toMatchObject({
            action: 'generate_recovery_link',
            target_institution_id: '22222222-2222-4222-a222-222222222222',
            new_poc_email: 'poc@cambridge.edu',
        });
    });

    it('generates an invite link when requested', async () => {
        const { POST } = await import(
            '../src/app/api/admin/institutions/[id]/recovery-link/route'
        );

        const request = new NextRequest(
            'http://localhost:3000/api/admin/institutions/22222222-2222-4222-a222-222222222222/recovery-link',
            {
                method: 'POST',
                headers: new Headers({
                    authorization: 'Bearer valid-admin-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({
                    type: 'invite',
                    reason: 'Initial POC onboarding fallback link',
                }),
            },
        );

        const response = await POST(request, {
            params: Promise.resolve({ id: '22222222-2222-4222-a222-222222222222' }),
        });

        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.link).toContain('single-use-invite');

        // The POC's pending membership, found via institution_users (#308), moves
        // to the new invite window, so the regenerated link is not refused.
        expect(state.membershipUpdates).toHaveLength(1);
        expect(state.membershipUpdates[0].values).toHaveProperty('invite_expires_at');
        expect(state.membershipUpdates[0].filters).toEqual(
            expect.arrayContaining([
                ['auth_user_id', 'user-cambridge-poc'],
                ['status', 'invited'],
            ]),
        );
    });

    function inviteRequest() {
        return new NextRequest(
            'http://localhost:3000/api/admin/institutions/22222222-2222-4222-a222-222222222222/recovery-link',
            {
                method: 'POST',
                headers: new Headers({ authorization: 'Bearer valid-admin-token', 'content-type': 'application/json' }),
                body: JSON.stringify({ type: 'invite', reason: 'Initial POC onboarding fallback link' }),
            },
        );
    }

    it('reports a failed membership lookup instead of handing out a link that would be refused', async () => {
        const { POST } = await import('../src/app/api/admin/institutions/[id]/recovery-link/route');
        state.ownerLookupError = { message: 'connection reset' };

        const response = await POST(inviteRequest(), {
            params: Promise.resolve({ id: '22222222-2222-4222-a222-222222222222' }),
        });

        expect(response.status).toBe(500);
        expect(state.membershipUpdates).toHaveLength(0);
    });

    it('still issues the link when there is no pending membership to move', async () => {
        const { POST } = await import('../src/app/api/admin/institutions/[id]/recovery-link/route');
        state.pendingOwner = null;

        const response = await POST(inviteRequest(), {
            params: Promise.resolve({ id: '22222222-2222-4222-a222-222222222222' }),
        });

        expect(response.status).toBe(200);
        expect(state.membershipUpdates).toHaveLength(0);
    });
});
