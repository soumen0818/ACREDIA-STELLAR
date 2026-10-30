import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type Tables } from './helpers/fakeSupabase';
import { SELF_DELETION_NOT_AVAILABLE } from '../src/lib/accountErasure';

/**
 * POST /api/account/erase (review §3.10).
 *
 * Only students delete their own account, and deletion is account-only.
 * Institution staff and admins are refused and sent to support, because
 * removing them can leave an institution unable to issue.
 *
 * What process_erasure() itself does is proven against Postgres in
 * tests/rls/erasure.rls.test.ts; here the fake records which calls the route
 * makes.
 */

const {
    mockRequireAuthenticatedRequest,
    mockGetServiceRoleClient,
    mockIsTrustedAdminEmail,
} = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockIsTrustedAdminEmail: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
    isTrustedAdminEmail: mockIsTrustedAdminEmail,
}));
vi.mock('../src/lib/rateLimit', () => ({ enforceRateLimit: vi.fn(async () => null) }));

import { POST } from '../src/app/api/account/erase/route';

const USER = 'user-1';
const INST = 'inst-1';

let tables: Tables;
let rpc: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;

function setup(seed: Partial<Tables> = {}, rpcError: { message: string } | null = null) {
    tables = {
        profiles: [{ id: USER, email: 'erin@student.test', role: 'student' }],
        institution_users: [],
        institutions: [],
        students: [{ id: 'student-1', auth_user_id: USER, institution_id: INST }],
        erasure_requests: [],
        ...seed,
    };
    const db = createFakeSupabase(tables, { rpc: () => ({ data: null, error: rpcError }) });
    rpc = db.rpc;
    deleteUser = vi.fn(async () => ({ error: null }));
    (db.client.auth.admin as unknown as Record<string, unknown>).deleteUser = deleteUser;
    mockGetServiceRoleClient.mockReturnValue(db.client);
    mockRequireAuthenticatedRequest.mockResolvedValue({
        ok: true,
        userId: USER,
        user: { id: USER, email: 'erin@student.test' },
    });
    mockIsTrustedAdminEmail.mockReturnValue(false);
}

const erase = () =>
    POST(
        new NextRequest('https://acredia.test/api/account/erase', {
            method: 'POST',
            headers: { Authorization: 'Bearer t' },
        }),
    );

beforeEach(() => vi.clearAllMocks());

describe('POST /api/account/erase — students delete their own account', () => {
    it('returns 401 without a valid session', async () => {
        setup();
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: false,
            status: 401,
            error: 'Missing access token',
        });

        const res = await erase();

        expect(res.status).toBe(401);
        expect(rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['a student', 'student'],
        ['an account with no role yet', undefined],
    ])(
        'erases %s: records the request, runs process_erasure, deletes the login',
        async (_label, role) => {
            setup({ profiles: role ? [{ id: USER, email: 'x@y.test', role }] : [] });

            const res = await erase();

            expect(res.status).toBe(204);
            expect(tables.erasure_requests).toHaveLength(1);
            expect(tables.erasure_requests[0]).toMatchObject({
                auth_user_id: USER,
                status: 'processing',
            });
            expect(rpc).toHaveBeenCalledWith('process_erasure', {
                p_request_id: tables.erasure_requests[0].id,
            });
            expect(deleteUser).toHaveBeenCalledWith(USER);
        },
    );

    it('never removes credentials or their documents: credentials stay verifiable', async () => {
        // A student with an issued credential: an old version of this route
        // unpinned its documents before erasing, which broke verification.
        // The fake client has no Storage API, so any attempt to delete the
        // document would also fail this test.
        const credential = { id: 'c1', student_id: 'student-1', document_path: 'inst-1/doc.pdf' };
        setup({ credentials: [{ ...credential }] });

        const res = await erase();

        expect(res.status).toBe(204);
        expect(tables.credentials).toEqual([credential]);
    });

    it('stops before deleting the login when process_erasure fails, and marks the request failed', async () => {
        setup({}, { message: 'boom' });

        const res = await erase();

        expect(res.status).toBe(500);
        expect(deleteUser).not.toHaveBeenCalled();
        expect(tables.erasure_requests[0]).toMatchObject({
            status: 'failed',
            failure_reason: 'boom',
        });
    });
});

describe('POST /api/account/erase — institution staff and admins are sent to support', () => {
    it.each([
        [
            'an institution profile',
            { profiles: [{ id: USER, email: 'x@y.test', role: 'institution' }] },
        ],
        ['an admin profile', { profiles: [{ id: USER, email: 'x@y.test', role: 'admin' }] }],
        [
            'an active institution membership',
            {
                institution_users: [
                    {
                        id: 'm1',
                        institution_id: INST,
                        auth_user_id: USER,
                        role: 'issuer',
                        status: 'active',
                    },
                ],
            },
        ],
        [
            // The membership row is the audit record of past issuing authority;
            // deleting the account would cascade it away.
            'only a removed membership',
            {
                institution_users: [
                    {
                        id: 'm1',
                        institution_id: INST,
                        auth_user_id: USER,
                        role: 'issuer',
                        status: 'removed',
                    },
                ],
            },
        ],
        [
            "being an institution's recorded contact",
            { institutions: [{ id: INST, name: 'Uni', auth_user_id: USER }] },
        ],
    ])('refuses an account with %s', async (_label, seed) => {
        setup(seed as Partial<Tables>);

        const res = await erase();
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.code).toBe(SELF_DELETION_NOT_AVAILABLE);
        expect(body.error).toMatch(/support/i);
        expect(tables.erasure_requests).toHaveLength(0);
        expect(rpc).not.toHaveBeenCalled();
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('refuses an admin identified by the trusted admin email list', async () => {
        setup();
        mockIsTrustedAdminEmail.mockReturnValue(true);

        const res = await erase();

        expect(res.status).toBe(403);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('fails closed when the eligibility lookup errors', async () => {
        setup();
        const client =
            mockGetServiceRoleClient.mock.results[0]?.value ?? mockGetServiceRoleClient();
        const realFrom = client.from;
        client.from = vi.fn((table: string) => {
            if (table !== 'institution_users') return realFrom(table);
            const failing = {
                select: () => failing,
                eq: () => failing,
                limit: async () => ({ data: null, error: { message: 'db down' } }),
            };
            return failing;
        });

        const res = await erase();

        expect(res.status).toBe(500);
        expect(tables.erasure_requests).toHaveLength(0);
        expect(deleteUser).not.toHaveBeenCalled();
    });
});
