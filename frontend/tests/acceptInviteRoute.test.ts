import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, fakeId, type Tables } from './helpers/fakeSupabase';

/**
 * POST /api/auth/accept-invite — per-membership acceptance (Issue #307).
 *
 * Before, acceptance was keyed on the institution's single
 * `invite_accepted_at`: once the POC had accepted, a second member's
 * acceptance returned "already accepted" without activating them, so they
 * could never act.
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

import { POST } from '../src/app/api/auth/accept-invite/route';

const INST = 'aaaaaaaa-0000-4000-8000-000000000001';
let tables: Tables;

function signIn(userId: string) {
    mockRequireAuthenticatedRequest.mockResolvedValue({
        ok: true,
        userId,
        user: { id: userId, email: `${userId}@uni.test` },
    });
}

const call = () =>
    POST(new NextRequest('https://acredia.test/api/auth/accept-invite', { method: 'POST', headers: { Authorization: 'Bearer t' } }));

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
    vi.clearAllMocks();
    tables = {
        institutions: [{ id: INST, name: 'University of Test', invite_accepted_at: '2026-09-01T00:00:00Z', auth_user_id: 'poc' }],
        institution_users: [
            { id: fakeId(), institution_id: INST, auth_user_id: 'poc', role: 'owner', status: 'active' },
        ],
        admin_audit_logs: [],
    };
    mockGetServiceRoleClient.mockReturnValue(createFakeSupabase(tables).client);
});

describe('POST /api/auth/accept-invite', () => {
    it("activates a second member even though the POC's invite was accepted long ago", async () => {
        const memberRow = { id: fakeId(), institution_id: INST, auth_user_id: 'second', role: 'issuer', status: 'invited', invite_expires_at: future() };
        tables.institution_users.push(memberRow);
        signIn('second');

        const response = await call();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toMatchObject({ success: true, alreadyAccepted: false, role: 'issuer', institution: { id: INST, name: 'University of Test' } });
        expect(memberRow).toMatchObject({ status: 'active' });
        expect(memberRow).toHaveProperty('accepted_at');
        expect(tables.admin_audit_logs[0]).toMatchObject({
            action: 'accept_invite',
            new_poc_id: 'second',
            details: expect.objectContaining({ role: 'issuer' }),
        });
        // The institution's own onboarding record is left as it was.
        expect(tables.institutions[0].invite_accepted_at).toBe('2026-09-01T00:00:00Z');
    });

    it("completes the institution's onboarding when its first owner accepts", async () => {
        tables.institutions[0].invite_accepted_at = null;
        tables.institution_users[0].status = 'invited';
        tables.institution_users[0].invite_expires_at = future();
        signIn('poc');

        const response = await call();

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ role: 'owner' });
        expect(tables.institutions[0].invite_accepted_at).toEqual(expect.any(String));
        expect(tables.institution_users[0].status).toBe('active');
    });

    it('refuses an expired invitation and leaves the membership pending', async () => {
        const memberRow = { id: fakeId(), institution_id: INST, auth_user_id: 'late', role: 'owner', status: 'invited', invite_expires_at: past() };
        tables.institution_users.push(memberRow);
        signIn('late');

        const response = await call();

        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ code: 'invite_expired' });
        expect(memberRow.status).toBe('invited');
    });

    it('does not let a removed member reopen access with an old link', async () => {
        tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: 'gone', role: 'issuer', status: 'deactivated' });
        // Even if the legacy single-login column still names them.
        tables.institutions[0].auth_user_id = 'gone';
        signIn('gone');

        const response = await call();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'membership_removed' });
    });

    it('treats a repeat call by an active member as already accepted', async () => {
        signIn('poc');
        const response = await call();
        expect(await response.json()).toMatchObject({ success: true, alreadyAccepted: true, role: 'owner' });
    });

    it('still serves a legacy POC who has no membership row at all', async () => {
        tables.institution_users = [];
        tables.institutions[0].invite_accepted_at = null;
        mockGetServiceRoleClient.mockReturnValue(createFakeSupabase(tables).client);
        signIn('poc');

        const response = await call();

        expect(response.status).toBe(200);
        expect(tables.institutions[0].invite_accepted_at).toEqual(expect.any(String));
    });

    it('404s for an account with no institution at all', async () => {
        signIn('nobody');
        expect((await call()).status).toBe(404);
    });
});
