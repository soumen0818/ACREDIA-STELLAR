import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, fakeId, type Tables } from './helpers/fakeSupabase';

/**
 * Account erasure and institution continuity (Issue #307).
 *
 * Erasure is a legal right and is never blocked. But the last person able to
 * issue for an institution must confirm the consequence first, and erasing one
 * member must not suspend an institution other members can still run.
 */

const { mockRequireAuthenticatedRequest, mockGetServiceRoleClient } = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));
vi.mock('../src/lib/rateLimit', () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock('../src/lib/ipfsServer', () => ({ unpinFromPinata: vi.fn(async () => undefined) }));

import { POST } from '../src/app/api/account/erase/route';

const INST = 'aaaaaaaa-0000-4000-8000-000000000001';
let tables: Tables;
let deleteUser: ReturnType<typeof vi.fn>;

function setup(members: Array<{ user: string; role: string; status?: string }>) {
    tables = {
        institutions: [{ id: INST, name: 'University of Test', auth_user_id: 'poc', status: 'verified' }],
        institution_users: members.map((m, index) => ({
            id: fakeId(),
            institution_id: INST,
            auth_user_id: m.user,
            role: m.role,
            status: m.status ?? 'active',
            created_at: `2026-0${index + 1}-01`,
        })),
        erasure_requests: [],
        students: [],
        admin_audit_logs: [],
    };
    const db = createFakeSupabase(tables, { rpc: () => ({ data: null, error: null }) });
    deleteUser = vi.fn(async () => ({ error: null }));
    (db.client.auth.admin as unknown as Record<string, unknown>).deleteUser = deleteUser;
    mockGetServiceRoleClient.mockReturnValue(db.client);
    mockRequireAuthenticatedRequest.mockResolvedValue({ ok: true, userId: 'poc', user: { id: 'poc' } });
}

const erase = (body?: unknown) =>
    POST(
        new NextRequest('https://acredia.test/api/account/erase', {
            method: 'POST',
            headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        }),
    );

beforeEach(() => vi.clearAllMocks());

describe('POST /api/account/erase — institution continuity', () => {
    it('stops and explains when the user is the last person able to issue', async () => {
        setup([{ user: 'poc', role: 'owner' }, { user: 'v', role: 'viewer' }]);

        const response = await erase();
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body).toMatchObject({
            code: 'last_institution_issuer',
            institutions: [{ institutionId: INST, name: 'University of Test' }],
        });
        expect(body.error).toMatch(/University of Test will be unable to issue/);
        // Nothing irreversible has started.
        expect(tables.erasure_requests).toHaveLength(0);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it('proceeds once acknowledged, suspends the now-unmanned institution, and records it', async () => {
        setup([{ user: 'poc', role: 'owner' }]);

        const response = await erase({ acknowledgeInstitutionImpact: true });

        expect(response.status).toBe(204);
        expect(deleteUser).toHaveBeenCalledWith('poc');
        expect(tables.institutions[0]).toMatchObject({ status: 'suspended', auth_user_id: null });
        expect(tables.admin_audit_logs[0]).toMatchObject({
            action: 'deactivate_account',
            details: expect.objectContaining({
                institution_left_without_members: true,
                institution_left_without_issuers: true,
            }),
        });
    });

    it('needs no confirmation, and hands the institution over, when a colleague can still issue', async () => {
        setup([
            { user: 'poc', role: 'owner' },
            { user: 'issuer-2', role: 'issuer' },
            { user: 'owner-2', role: 'owner' },
        ]);

        const response = await erase();

        expect(response.status).toBe(204);
        // Not suspended: the other members keep working. An owner is preferred.
        expect(tables.institutions[0]).toMatchObject({ status: 'verified', auth_user_id: 'owner-2' });
        expect(tables.admin_audit_logs[0].details).toMatchObject({
            remaining_active_members: 2,
            remaining_issuers: 2,
            institution_left_without_issuers: false,
        });
    });

    it('records when only viewers remain, even though members remain', async () => {
        setup([{ user: 'poc', role: 'owner' }, { user: 'v', role: 'viewer' }]);

        await erase({ acknowledgeInstitutionImpact: true });

        expect(tables.institutions[0]).toMatchObject({ status: 'suspended' });
        expect(tables.admin_audit_logs[0].details).toMatchObject({
            institution_left_without_members: false,
            institution_left_without_issuers: true,
        });
    });

    it('does not ask a viewer to confirm anything', async () => {
        setup([{ user: 'poc', role: 'viewer' }, { user: 'o', role: 'owner' }]);
        expect((await erase()).status).toBe(204);
    });
});
