import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, fakeId, type Tables } from './helpers/fakeSupabase';

/**
 * Team-management routes (Issue #307): any member can see the team; only
 * owners can change it; the guard's refusals reach the caller intact; and an
 * invitation link never appears in a response.
 */

const { mockRequireAuthenticatedRequest, mockGetServiceRoleClient, mockEnforceRateLimit } = vi.hoisted(
    () => ({
        mockRequireAuthenticatedRequest: vi.fn(),
        mockGetServiceRoleClient: vi.fn(),
        mockEnforceRateLimit: vi.fn(),
    }),
);

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock('../src/lib/rateLimit', () => ({ enforceRateLimit: mockEnforceRateLimit }));

import { GET, POST } from '../src/app/api/institution/members/route';
import { DELETE, PATCH } from '../src/app/api/institution/members/[memberId]/route';
import { POST as RESEND } from '../src/app/api/institution/members/[memberId]/resend/route';

const INST = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_INST = 'bbbbbbbb-0000-4000-8000-000000000002';

let tables: Tables;
let db: ReturnType<typeof createFakeSupabase>;
let ownerRowId: string;
let viewerRowId: string;

function signIn(userId: string, email: string) {
    mockRequireAuthenticatedRequest.mockResolvedValue({ ok: true, userId, user: { id: userId, email } });
}

function req(method: string, path: string, body?: unknown) {
    return new NextRequest(`https://acredia.test${path}`, {
        method,
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const ctx = (memberId: string) => ({ params: Promise.resolve({ memberId }) });

beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
    ownerRowId = fakeId();
    viewerRowId = fakeId();
    tables = {
        institution_users: [
            { id: ownerRowId, institution_id: INST, auth_user_id: 'owner', role: 'owner', status: 'active', created_at: '2026-01-01' },
            { id: viewerRowId, institution_id: INST, auth_user_id: 'viewer', role: 'viewer', status: 'active', created_at: '2026-02-01' },
            { id: fakeId(), institution_id: OTHER_INST, auth_user_id: 'outsider', role: 'owner', status: 'active' },
        ],
        profiles: [
            { id: 'owner', email: 'owner@uni.test', full_name: 'Olive Owner' },
            { id: 'viewer', email: 'viewer@uni.test', full_name: 'Vic Viewer' },
        ],
        institutions: [{ id: INST, name: 'University of Test' }],
        admin_audit_logs: [],
    };
    db = createFakeSupabase(tables, {
        rpc: (_name, args) => {
            const row = tables.institution_users.find(
                (r) => r.id === args.p_member_id && r.institution_id === args.p_institution_id,
            );
            if (!row) return { data: null, error: { message: 'member_not_found' } };
            if (row.role === 'owner' && args.p_action === 'remove') {
                return { data: null, error: { message: 'last_owner', code: 'P0001' } };
            }
            if (args.p_action === 'remove') row.status = 'deactivated';
            else row.role = args.p_new_role;
            return { data: row, error: null };
        },
    });
    mockGetServiceRoleClient.mockReturnValue(db.client);
});

describe('GET /api/institution/members', () => {
    it('shows any active member their team and continuity', async () => {
        signIn('viewer', 'viewer@uni.test');

        const response = await GET(req('GET', '/api/institution/members'));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.canManage).toBe(false);
        expect(body.members.map((m: { email: string }) => m.email)).toEqual(['owner@uni.test', 'viewer@uni.test']);
        expect(body.continuity).toMatchObject({ level: 'single_issuer', activeIssuers: 1 });
    });

    it('refuses someone who is not an active member', async () => {
        signIn('stranger', 'stranger@x.test');
        const response = await GET(req('GET', '/api/institution/members'));
        expect(response.status).toBe(403);
    });

    it('passes authentication failures through', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: false, status: 401, error: 'Missing access token' });
        expect((await GET(req('GET', '/api/institution/members'))).status).toBe(401);
    });
});

describe('POST /api/institution/members', () => {
    it('lets an owner invite a colleague by email, with no link in the response, and audits it', async () => {
        signIn('owner', 'owner@uni.test');

        const response = await POST(
            req('POST', '/api/institution/members', { email: 'new@uni.test', name: 'Nia New', role: 'owner' }),
        );
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
        expect(db.inviteUserByEmail).toHaveBeenCalledWith('new@uni.test', {
            redirectTo: 'https://acredia.test/auth/accept-invite?next=/dashboard',
            data: { name: 'Nia New', role: 'institution' },
        });
        expect(tables.admin_audit_logs).toEqual([
            expect.objectContaining({
                action: 'invite_member',
                target_institution_id: INST,
                new_poc_email: 'new@uni.test',
                details: expect.objectContaining({ actorUserId: 'owner', role: 'owner' }),
            }),
        ]);
        // The quota is per institution, so one busy owner cannot spam on behalf of another.
        expect(mockEnforceRateLimit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ prefix: 'institution-member-invite', identifier: INST }),
        );
    });

    it('forbids a viewer from inviting', async () => {
        signIn('viewer', 'viewer@uni.test');
        const response = await POST(
            req('POST', '/api/institution/members', { email: 'new@uni.test', name: 'Nia New', role: 'owner' }),
        );
        expect(response.status).toBe(403);
        expect(db.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('validates the payload', async () => {
        signIn('owner', 'owner@uni.test');
        for (const body of [
            { email: 'not-an-email', name: 'Nia', role: 'owner' },
            { email: 'new@uni.test', name: 'N', role: 'owner' },
            { email: 'new@uni.test', name: 'Nia New', role: 'poc' },
        ]) {
            expect((await POST(req('POST', '/api/institution/members', body))).status).toBe(400);
        }
    });

    it('returns typed invitation errors', async () => {
        signIn('owner', 'owner@uni.test');
        const response = await POST(
            req('POST', '/api/institution/members', { email: 'viewer@uni.test', name: 'Vic Viewer', role: 'issuer' }),
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'already_member' });
    });
});

describe('PATCH / DELETE /api/institution/members/[memberId]', () => {
    it('lets an owner change a role and audits it', async () => {
        signIn('owner', 'owner@uni.test');

        const response = await PATCH(req('PATCH', `/api/institution/members/${viewerRowId}`, { role: 'issuer' }), ctx(viewerRowId));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ member: { id: viewerRowId, role: 'issuer' } });
        expect(tables.admin_audit_logs[0]).toMatchObject({
            action: 'change_member_role',
            previous_poc_id: 'viewer',
            details: expect.objectContaining({ newRole: 'issuer', actorUserId: 'owner' }),
        });
    });

    it('lets an owner remove a member', async () => {
        signIn('owner', 'owner@uni.test');

        const response = await DELETE(req('DELETE', `/api/institution/members/${viewerRowId}`), ctx(viewerRowId));

        expect(response.status).toBe(200);
        expect(tables.institution_users.find((r) => r.id === viewerRowId)?.status).toBe('deactivated');
        expect(tables.admin_audit_logs[0]).toMatchObject({ action: 'remove_member' });
    });

    it('surfaces the last-owner refusal loudly instead of failing silently', async () => {
        signIn('owner', 'owner@uni.test');

        const response = await DELETE(req('DELETE', `/api/institution/members/${ownerRowId}`), ctx(ownerRowId));
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body).toMatchObject({ success: false, code: 'last_owner' });
        expect(body.error).toMatch(/only owner/i);
        expect(tables.admin_audit_logs).toHaveLength(0);
    });

    it("cannot reach another institution's members", async () => {
        signIn('owner', 'owner@uni.test');
        const foreign = tables.institution_users[2].id as string;

        const response = await DELETE(req('DELETE', `/api/institution/members/${foreign}`), ctx(foreign));

        expect(response.status).toBe(404);
        expect(tables.institution_users[2].status).toBe('active');
    });

    it('forbids non-owners and rejects malformed ids and roles', async () => {
        signIn('viewer', 'viewer@uni.test');
        expect((await DELETE(req('DELETE', `/api/institution/members/${ownerRowId}`), ctx(ownerRowId))).status).toBe(403);

        signIn('owner', 'owner@uni.test');
        expect((await DELETE(req('DELETE', '/api/institution/members/nope'), ctx('nope'))).status).toBe(400);
        expect(
            (await PATCH(req('PATCH', `/api/institution/members/${viewerRowId}`, { role: 'admin' }), ctx(viewerRowId))).status,
        ).toBe(400);
    });
});

describe('POST /api/institution/members/[memberId]/resend', () => {
    it('re-sends a pending invitation without returning a link', async () => {
        const pendingId = fakeId();
        tables.institution_users.push({ id: pendingId, institution_id: INST, auth_user_id: 'pending', role: 'owner', status: 'invited' });
        tables.profiles.push({ id: 'pending', email: 'pending@uni.test', full_name: 'Pat' });
        signIn('owner', 'owner@uni.test');

        const response = await RESEND(req('POST', `/api/institution/members/${pendingId}/resend`), ctx(pendingId));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
        expect(db.inviteUserByEmail).toHaveBeenCalledWith('pending@uni.test', expect.anything());
        expect(tables.admin_audit_logs[0]).toMatchObject({ action: 'resend_member_invite' });
    });

    it('refuses to resend to an active member', async () => {
        signIn('owner', 'owner@uni.test');
        const response = await RESEND(req('POST', `/api/institution/members/${viewerRowId}/resend`), ctx(viewerRowId));
        expect(response.status).toBe(409);
    });
});
