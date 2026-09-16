import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type MockDbState = {
    institution: { id: string; name: string; email: string; auth_user_id: string } | null;
    profiles: Record<string, { id: string; email: string; role: string; is_active: boolean; deactivated_at?: string | null; deactivated_reason?: string | null }>;
    institutionUsers: Array<{ institution_id: string; auth_user_id: string; role: string; is_active: boolean }>;
    auditLogs: Array<Record<string, unknown>>;
    authUserEmail: string;
    profileRole: string;
};

const state: MockDbState = {
    institution: {
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Oxford University',
        email: 'old.poc@oxford.edu',
        auth_user_id: 'user-old-poc',
    },
    profiles: {
        'user-old-poc': {
            id: 'user-old-poc',
            email: 'old.poc@oxford.edu',
            role: 'institution',
            is_active: true,
        },
    },
    institutionUsers: [
        {
            institution_id: '11111111-1111-4111-a111-111111111111',
            auth_user_id: 'user-old-poc',
            role: 'poc',
            is_active: true,
        },
    ],
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
                    createUser: vi.fn(async ({ email, user_metadata }: { email: string; user_metadata?: { name?: string } }) => {
                        const newId = `user-${email.split('@')[0]}`;
                        return {
                            data: {
                                user: {
                                    id: newId,
                                    email,
                                    user_metadata,
                                },
                            },
                            error: null,
                        };
                    }),
                    listUsers: vi.fn(async () => ({
                        data: { users: [] },
                        error: null,
                    })),
                    generateLink: vi.fn(async ({ type, email: _email }: { type: string; email: string }) => ({
                        data: {
                            properties: {
                                action_link: `https://example.supabase.co/auth/v1/verify?token=mock-${type}-token&type=${type}&redirect_to=http://localhost:3000/auth/reset-password`,
                            },
                        },
                        error: null,
                    })),
                },
            },
            from: vi.fn((tableName: string) => ({
                select: vi.fn(() => ({
                    eq: vi.fn((col: string, val: string) => ({
                        maybeSingle: vi.fn(async () => {
                            if (tableName === 'profiles') {
                                if (col === 'id' && val === 'admin-user-id') {
                                    return { data: { role: state.profileRole }, error: null };
                                }
                                return { data: state.profiles[val] || null, error: null };
                            }
                            if (tableName === 'institutions') {
                                return { data: state.institution, error: null };
                            }
                            return { data: null, error: null };
                        }),
                        order: vi.fn(() => ({
                            limit: vi.fn(async () => ({ data: state.auditLogs, error: null })),
                        })),
                    })),
                })),
                update: vi.fn((updates: Record<string, unknown>) => ({
                    eq: vi.fn((col1: string, val1: string) => {
                        if (tableName === 'profiles' && col1 === 'id') {
                            if (state.profiles[val1]) {
                                Object.assign(state.profiles[val1], updates);
                            }
                        }
                        if (tableName === 'institutions' && col1 === 'id') {
                            if (state.institution) {
                                Object.assign(state.institution, updates);
                            }
                        }
                        return {
                            eq: vi.fn((col2: string, val2: string) => {
                                if (tableName === 'institution_users') {
                                    const match = state.institutionUsers.find(
                                        (u) => u.institution_id === val1 && u.auth_user_id === val2,
                                    );
                                    if (match) {
                                        Object.assign(match, updates);
                                    }
                                }
                                return Promise.resolve({ error: null });
                            }),
                            then: (resolve: (arg: unknown) => unknown) => resolve({ error: null }),
                        };
                    }),
                })),
                upsert: vi.fn(async (data: Record<string, unknown>) => {
                    if (tableName === 'profiles') {
                        const id = data.id as string;
                        state.profiles[id] = {
                            id,
                            email: data.email as string,
                            role: data.role as string,
                            is_active: data.is_active as boolean,
                            deactivated_at: data.deactivated_at as string | null,
                            deactivated_reason: data.deactivated_reason as string | null,
                        };
                    }
                    if (tableName === 'institution_users') {
                        state.institutionUsers.push(data as unknown as MockDbState['institutionUsers'][0]);
                    }
                    return { error: null };
                }),
                insert: vi.fn(async (data: Record<string, unknown>) => {
                    if (tableName === 'admin_audit_logs') {
                        state.auditLogs.push(data);
                    }
                    return { error: null };
                }),
            })),
        };
    }),
}));

describe('POST /api/admin/institutions/[id]/poc-handover', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
        process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';

        state.institution = {
            id: '11111111-1111-4111-a111-111111111111',
            name: 'Oxford University',
            email: 'old.poc@oxford.edu',
            auth_user_id: 'user-old-poc',
        };
        state.profiles = {
            'user-old-poc': {
                id: 'user-old-poc',
                email: 'old.poc@oxford.edu',
                role: 'institution',
                is_active: true,
            },
        };
        state.institutionUsers = [
            {
                institution_id: '11111111-1111-4111-a111-111111111111',
                auth_user_id: 'user-old-poc',
                role: 'poc',
                is_active: true,
            },
        ];
        state.auditLogs = [];
    });

    it('successfully completes POC handover, deactivates old POC, provisions new POC and logs audit record', async () => {
        const { POST } = await import(
            '../src/app/api/admin/institutions/[id]/poc-handover/route'
        );

        const request = new NextRequest(
            'http://localhost:3000/api/admin/institutions/11111111-1111-4111-a111-111111111111/poc-handover',
            {
                method: 'POST',
                headers: new Headers({
                    authorization: 'Bearer valid-admin-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({
                    newPocName: 'Dr. Alistair Finch',
                    newPocEmail: 'alistair.finch@oxford.edu',
                    requesterEmail: 'registrar@oxford.edu',
                    verificationMethod: 'Official registrar letter on university letterhead',
                    notes: 'Ticket #4092 - POC transition',
                }),
            },
        );

        const response = await POST(request, {
            params: Promise.resolve({ id: '11111111-1111-4111-a111-111111111111' }),
        });

        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.inviteLink).toContain('mock-recovery-token');

        // Verify previous POC account is DEACTIVATED (is_active = false), never deleted
        expect(state.profiles['user-old-poc'].is_active).toBe(false);
        expect(state.profiles['user-old-poc'].deactivated_reason).toContain('Replaced during POC handover');

        // Verify institution record updated with new POC email
        expect(state.institution?.email).toBe('alistair.finch@oxford.edu');

        // Verify audit log entry was created
        expect(state.auditLogs.length).toBe(1);
        expect(state.auditLogs[0]).toMatchObject({
            action: 'poc_handover',
            previous_poc_email: 'old.poc@oxford.edu',
            new_poc_email: 'alistair.finch@oxford.edu',
            requester_email: 'registrar@oxford.edu',
        });
    });

    it('rejects handover without required fields', async () => {
        const { POST } = await import(
            '../src/app/api/admin/institutions/[id]/poc-handover/route'
        );

        const request = new NextRequest(
            'http://localhost:3000/api/admin/institutions/11111111-1111-4111-a111-111111111111/poc-handover',
            {
                method: 'POST',
                headers: new Headers({
                    authorization: 'Bearer valid-admin-token',
                    'content-type': 'application/json',
                }),
                body: JSON.stringify({
                    newPocName: 'A', // Too short
                    newPocEmail: 'invalid-email',
                }),
            },
        );

        const response = await POST(request, {
            params: Promise.resolve({ id: '11111111-1111-4111-a111-111111111111' }),
        });

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.success).toBe(false);
    });
});
