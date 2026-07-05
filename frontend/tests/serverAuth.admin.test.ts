import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type SupabaseMockState = {
    tokenUserId?: string;
    authUserEmail?: string;
    profileRole?: string;
    authError?: Error;
    profileError?: Error;
};

const state: SupabaseMockState = {};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn((_url: string, key: string) => {
        if (key === 'anon-key') {
            return {
                auth: {
                    getUser: vi.fn(async () => ({
                        data: state.tokenUserId
                            ? { user: { id: state.tokenUserId } }
                            : { user: null },
                        error: state.tokenUserId ? null : new Error('Invalid token'),
                    })),
                },
            };
        }

        return {
            auth: {
                admin: {
                    getUserById: vi.fn(async () => ({
                        data: state.authUserEmail
                            ? { user: { email: state.authUserEmail } }
                            : { user: null },
                        error: state.authError ?? null,
                    })),
                },
            },
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                            data: state.profileRole ? { role: state.profileRole } : null,
                            error: state.profileError ?? null,
                        })),
                    })),
                })),
            })),
        };
    }),
}));

describe('requireAdminRequest', () => {
    async function loadRequireAdminRequest(allowlist: string) {
        vi.resetModules();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
        process.env.ADMIN_EMAIL_ALLOWLIST = allowlist;

        const mod = await import('../src/lib/serverAuth');
        return mod.requireAdminRequest;
    }

    function requestWithToken(): NextRequest {
        return {
            headers: new Headers({
                authorization: 'Bearer valid-token',
            }),
        } as NextRequest;
    }

    it('allows an allowlisted email with an admin profile', async () => {
        Object.assign(state, {
            tokenUserId: 'user-1',
            authUserEmail: 'admin@example.com',
            profileRole: 'admin',
            authError: undefined,
            profileError: undefined,
        });

        const requireAdminRequest = await loadRequireAdminRequest('admin@example.com');

        await expect(requireAdminRequest(requestWithToken())).resolves.toEqual({
            ok: true,
            userId: 'user-1',
        });
    });

    it('denies an admin profile when the email is not allowlisted', async () => {
        Object.assign(state, {
            tokenUserId: 'user-1',
            authUserEmail: 'attacker@example.com',
            profileRole: 'admin',
            authError: undefined,
            profileError: undefined,
        });

        const requireAdminRequest = await loadRequireAdminRequest('admin@example.com');

        await expect(requireAdminRequest(requestWithToken())).resolves.toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('denies an allowlisted email without an admin profile', async () => {
        Object.assign(state, {
            tokenUserId: 'user-1',
            authUserEmail: 'admin@example.com',
            profileRole: 'student',
            authError: undefined,
            profileError: undefined,
        });

        const requireAdminRequest = await loadRequireAdminRequest('admin@example.com');

        await expect(requireAdminRequest(requestWithToken())).resolves.toMatchObject({
            ok: false,
            status: 403,
            error: 'Admin access required',
        });
    });
});
