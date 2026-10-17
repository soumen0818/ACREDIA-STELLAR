import { describe, expect, it } from 'vitest';
import {
    changeInstitutionMember,
    institutionsLeftWithoutIssuer,
    inviteInstitutionMember,
    listInstitutionTeam,
    MAX_INSTITUTION_MEMBERS,
    MemberChangeError,
    MemberInviteError,
    MemberResendError,
    resendMemberInvitation,
} from '../src/lib/institutionMembers';
import { createFakeSupabase, fakeId, type Tables } from './helpers/fakeSupabase';

/** Self-service institution membership (Issue #307). */

const INST = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_INST = 'bbbbbbbb-0000-4000-8000-000000000002';
const OWNER = 'owner-user';
const NOW = new Date('2026-10-17T12:00:00Z');
const REDIRECT = 'https://acredia.test/auth/accept-invite?next=/dashboard';

function seed(): Tables {
    return {
        institution_users: [
            { id: fakeId(), institution_id: INST, auth_user_id: OWNER, role: 'owner', status: 'active' },
        ],
        profiles: [{ id: OWNER, email: 'owner@uni.test', full_name: 'Olive Owner', role: 'institution' }],
        institutions: [{ id: INST, name: 'University of Test' }, { id: OTHER_INST, name: 'Elsewhere' }],
    };
}

function invite(overrides: Partial<Parameters<typeof inviteInstitutionMember>[1]> = {}) {
    return {
        institutionId: INST,
        inviterId: OWNER,
        inviterEmail: 'owner@uni.test',
        email: 'Second@Uni.test',
        name: 'Sam Second',
        role: 'owner' as const,
        redirectTo: REDIRECT,
        now: NOW,
        ...overrides,
    };
}

describe('inviteInstitutionMember', () => {
    it('emails a new colleague and records a pending owner membership', async () => {
        const db = createFakeSupabase(seed());

        const result = await inviteInstitutionMember(db.client, invite());

        // The invitation goes to the invitee's inbox — the link is never handed
        // back to the inviter, who could otherwise impersonate them.
        expect(db.inviteUserByEmail).toHaveBeenCalledWith('second@uni.test', {
            redirectTo: REDIRECT,
            data: { name: 'Sam Second', role: 'institution' },
        });
        expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);

        const membership = db.tables.institution_users.find((row) => row.id === result.memberId);
        expect(membership).toMatchObject({
            institution_id: INST,
            auth_user_id: result.authUserId,
            role: 'owner',
            status: 'invited',
            invited_by: OWNER,
            invite_expires_at: '2026-10-24T12:00:00.000Z',
        });
        expect(db.tables.profiles.find((row) => row.id === result.authUserId)).toMatchObject({
            email: 'second@uni.test',
            role: 'institution',
            full_name: 'Sam Second',
        });
    });

    it('refuses to invite yourself', async () => {
        const db = createFakeSupabase(seed());
        await expect(
            inviteInstitutionMember(db.client, invite({ email: 'OWNER@uni.test' })),
        ).rejects.toMatchObject({ code: 'self_invite' });
        expect(db.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('refuses an email that belongs to an unrelated Acredia account, without saying what kind', async () => {
        const tables = seed();
        tables.profiles.push({ id: 'student-1', email: 'second@uni.test', role: 'student' });
        const db = createFakeSupabase(tables);

        const attempt = inviteInstitutionMember(db.client, invite());
        await expect(attempt).rejects.toBeInstanceOf(MemberInviteError);
        await expect(attempt).rejects.toMatchObject({ code: 'email_in_use', status: 409 });
        await expect(attempt).rejects.not.toThrow(/student/i);
        expect(db.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('distinguishes an existing member from a pending invitation', async () => {
        const tables = seed();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test', role: 'institution' });
        tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: 'u2', role: 'issuer', status: 'invited' });
        const db = createFakeSupabase(tables);

        await expect(inviteInstitutionMember(db.client, invite())).rejects.toMatchObject({ code: 'already_invited' });

        tables.institution_users[1].status = 'active';
        await expect(inviteInstitutionMember(db.client, invite())).rejects.toMatchObject({ code: 'already_member' });
    });

    it('re-invites a former member through a password-reset email and reopens their membership', async () => {
        const tables = seed();
        const formerId = fakeId();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test', role: 'institution' });
        tables.institution_users.push({
            id: formerId,
            institution_id: INST,
            auth_user_id: 'u2',
            role: 'viewer',
            status: 'deactivated',
            removed_at: '2026-09-01T00:00:00Z',
        });
        const db = createFakeSupabase(tables, {
            inviteUserByEmail: () => ({ data: { user: null }, error: { message: 'User already registered' } }),
        });

        const result = await inviteInstitutionMember(db.client, invite({ role: 'issuer' }));

        expect(result).toMatchObject({ memberId: formerId, reinvited: true });
        expect(db.resetPasswordForEmail).toHaveBeenCalledWith('second@uni.test', { redirectTo: REDIRECT });
        expect(tables.institution_users.find((row) => row.id === formerId)).toMatchObject({
            status: 'invited',
            role: 'issuer',
            removed_at: null,
        });
    });

    it('closes a reopened membership again when the email cannot be sent', async () => {
        const tables = seed();
        const formerId = fakeId();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test', role: 'institution' });
        tables.institution_users.push({ id: formerId, institution_id: INST, auth_user_id: 'u2', role: 'viewer', status: 'deactivated' });
        const db = createFakeSupabase(tables, {
            inviteUserByEmail: () => ({ data: { user: null }, error: { message: 'User already registered' } }),
            resetPasswordForEmail: () => ({ data: null, error: { message: 'SMTP rate limit' } }),
        });

        await expect(inviteInstitutionMember(db.client, invite())).rejects.toMatchObject({
            code: 'delivery_failed',
            status: 502,
        });
        expect(tables.institution_users.find((row) => row.id === formerId)?.status).toBe('deactivated');
    });

    it('reports a mail failure for a new invitee without creating a membership', async () => {
        const db = createFakeSupabase(seed(), {
            inviteUserByEmail: () => ({ data: { user: null }, error: { message: 'Error sending invite email' } }),
        });

        await expect(inviteInstitutionMember(db.client, invite())).rejects.toMatchObject({ code: 'delivery_failed' });
        expect(db.tables.institution_users).toHaveLength(1);
    });

    it('caps the team size', async () => {
        const tables = seed();
        for (let i = 1; i < MAX_INSTITUTION_MEMBERS; i++) {
            tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: `u${i}`, role: 'viewer', status: i % 2 ? 'active' : 'invited' });
        }
        const db = createFakeSupabase(tables);

        await expect(inviteInstitutionMember(db.client, invite())).rejects.toMatchObject({ code: 'team_full' });
    });
});

describe('changeInstitutionMember', () => {
    it.each([
        ['last_owner', 409],
        ['last_issuer', 409],
        ['member_not_found', 404],
    ] as const)('maps the database guard exception %s to a typed %i', async (message, status) => {
        const db = createFakeSupabase(seed(), {
            rpc: () => ({ data: null, error: { message, code: 'P0001', hint: '' } }),
        });

        const attempt = changeInstitutionMember(db.client, {
            institutionId: INST,
            memberId: fakeId(),
            action: 'remove',
            actorId: OWNER,
        });

        await expect(attempt).rejects.toBeInstanceOf(MemberChangeError);
        await expect(attempt).rejects.toMatchObject({ code: message, status });
    });

    it('passes the guarded change to the database function', async () => {
        const memberId = fakeId();
        const db = createFakeSupabase(seed(), {
            rpc: () => ({ data: { id: memberId, auth_user_id: 'u2', role: 'viewer', status: 'active' }, error: null }),
        });

        const result = await changeInstitutionMember(db.client, {
            institutionId: INST,
            memberId,
            action: 'set_role',
            role: 'viewer',
            actorId: OWNER,
        });

        expect(db.rpc).toHaveBeenCalledWith('change_institution_member', {
            p_institution_id: INST,
            p_member_id: memberId,
            p_action: 'set_role',
            p_new_role: 'viewer',
            p_actor_id: OWNER,
        });
        expect(result).toEqual({ id: memberId, authUserId: 'u2', role: 'viewer', status: 'active' });
    });

    it('never sends a role for a removal', async () => {
        const db = createFakeSupabase(seed(), {
            rpc: () => ({ data: [{ id: 'm', auth_user_id: 'u2', role: 'issuer', status: 'deactivated' }], error: null }),
        });

        await changeInstitutionMember(db.client, {
            institutionId: INST,
            memberId: 'm',
            action: 'remove',
            role: 'owner',
            actorId: OWNER,
        });

        expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_action: 'remove', p_new_role: null });
    });

    it('rethrows unexpected database errors untouched', async () => {
        const failure = { message: 'connection reset', code: '08006' };
        const db = createFakeSupabase(seed(), { rpc: () => ({ data: null, error: failure }) });

        await expect(
            changeInstitutionMember(db.client, { institutionId: INST, memberId: 'm', action: 'remove', actorId: OWNER }),
        ).rejects.toBe(failure);
    });
});

describe('resendMemberInvitation', () => {
    it('re-emails a pending invite and restarts its window', async () => {
        const tables = seed();
        const memberId = fakeId();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test', full_name: 'Sam' });
        tables.institution_users.push({ id: memberId, institution_id: INST, auth_user_id: 'u2', role: 'owner', status: 'invited', invite_expires_at: '2026-10-01T00:00:00Z' });
        const db = createFakeSupabase(tables);

        const result = await resendMemberInvitation(db.client, { institutionId: INST, memberId, redirectTo: REDIRECT, now: NOW });

        expect(db.inviteUserByEmail).toHaveBeenCalledWith('second@uni.test', expect.objectContaining({ redirectTo: REDIRECT }));
        expect(result.inviteExpiresAt).toBe('2026-10-24T12:00:00.000Z');
        expect(tables.institution_users.find((row) => row.id === memberId)?.invite_expires_at).toBe(result.inviteExpiresAt);
    });

    it('falls back to a password-reset email when the invitee account already exists', async () => {
        const tables = seed();
        const memberId = fakeId();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test' });
        tables.institution_users.push({ id: memberId, institution_id: INST, auth_user_id: 'u2', role: 'owner', status: 'invited' });
        const db = createFakeSupabase(tables, {
            inviteUserByEmail: () => ({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } }),
        });

        await resendMemberInvitation(db.client, { institutionId: INST, memberId, redirectTo: REDIRECT, now: NOW });

        expect(db.resetPasswordForEmail).toHaveBeenCalledWith('second@uni.test', { redirectTo: REDIRECT });
    });

    it('refuses active members and other institutions', async () => {
        const tables = seed();
        const db = createFakeSupabase(tables);
        const ownerRow = tables.institution_users[0].id as string;

        await expect(
            resendMemberInvitation(db.client, { institutionId: INST, memberId: ownerRow, redirectTo: REDIRECT }),
        ).rejects.toMatchObject({ code: 'not_pending' });
        await expect(
            resendMemberInvitation(db.client, { institutionId: OTHER_INST, memberId: ownerRow, redirectTo: REDIRECT }),
        ).rejects.toBeInstanceOf(MemberResendError);
    });
});

describe('listInstitutionTeam', () => {
    it('lists active and pending members with their status, hides removed ones, and assesses continuity', async () => {
        const tables = seed();
        tables.profiles.push({ id: 'u2', email: 'second@uni.test', full_name: 'Sam' });
        tables.institution_users.push(
            { id: fakeId(), institution_id: INST, auth_user_id: 'u2', role: 'issuer', status: 'invited', invite_expires_at: '2026-10-20T00:00:00Z' },
            { id: fakeId(), institution_id: INST, auth_user_id: 'u3', role: 'viewer', status: 'invited', invite_expires_at: '2026-10-01T00:00:00Z' },
            { id: fakeId(), institution_id: INST, auth_user_id: 'u4', role: 'owner', status: 'deactivated' },
            { id: fakeId(), institution_id: OTHER_INST, auth_user_id: 'u5', role: 'owner', status: 'active' },
        );
        const db = createFakeSupabase(tables);

        const team = await listInstitutionTeam(db.client, INST, OWNER, NOW);

        expect(team.members.map((m) => [m.email, m.role, m.status, m.isYou])).toEqual([
            ['owner@uni.test', 'owner', 'active', true],
            ['second@uni.test', 'issuer', 'invited', false],
            [null, 'viewer', 'expired', false],
        ]);
        expect(team.continuity).toMatchObject({ level: 'single_issuer', pendingInvites: 1 });
    });

    it('shows legacy roles in the three-role vocabulary', async () => {
        const tables = seed();
        tables.institution_users[0].role = 'poc';
        const db = createFakeSupabase(tables);

        const team = await listInstitutionTeam(db.client, INST, null, NOW);
        expect(team.members[0]).toMatchObject({ role: 'owner', isYou: false });
    });
});

describe('institutionsLeftWithoutIssuer', () => {
    it('names institutions where the user is the last person able to issue', async () => {
        const tables = seed();
        tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: 'viewer-1', role: 'viewer', status: 'active' });
        const db = createFakeSupabase(tables);

        expect(await institutionsLeftWithoutIssuer(db.client, OWNER)).toEqual([
            { institutionId: INST, name: 'University of Test' },
        ]);
    });

    it('is empty once another active issuer exists', async () => {
        const tables = seed();
        tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: 'u2', role: 'issuer', status: 'active' });
        const db = createFakeSupabase(tables);

        expect(await institutionsLeftWithoutIssuer(db.client, OWNER)).toEqual([]);
    });

    it('does not count a pending invitation as cover', async () => {
        const tables = seed();
        tables.institution_users.push({ id: fakeId(), institution_id: INST, auth_user_id: 'u2', role: 'owner', status: 'invited' });
        const db = createFakeSupabase(tables);

        expect(await institutionsLeftWithoutIssuer(db.client, OWNER)).toHaveLength(1);
    });

    it('ignores institutions where the user is only a viewer', async () => {
        const tables = seed();
        tables.institution_users[0].role = 'viewer';
        const db = createFakeSupabase(tables);

        expect(await institutionsLeftWithoutIssuer(db.client, OWNER)).toEqual([]);
    });
});
