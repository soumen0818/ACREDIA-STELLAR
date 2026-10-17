import { describe, expect, it } from 'vitest';
import { AT_RISK_LEVELS, assessContinuity, isInviteExpired } from '../src/lib/institutionContinuity';

/** Institution continuity — who can keep issuing if one person is unavailable (Issue #307). */

const NOW = new Date('2026-10-17T12:00:00Z');
const active = (role: string) => ({ role, status: 'active' });

describe('assessContinuity', () => {
    it('flags an institution with no active members as unable to issue', () => {
        expect(assessContinuity([], NOW)).toMatchObject({ level: 'no_issuers', activeIssuers: 0 });
    });

    it('treats viewers as unable to issue', () => {
        expect(assessContinuity([active('viewer'), active('member')], NOW)).toMatchObject({
            level: 'no_issuers',
            activeMembers: 2,
            activeIssuers: 0,
        });
    });

    it('flags the classic single point of contact', () => {
        expect(assessContinuity([active('owner')], NOW).level).toBe('single_issuer');
        // A viewer colleague does not help: they cannot issue.
        expect(assessContinuity([active('owner'), active('viewer')], NOW).level).toBe('single_issuer');
    });

    it('does not count a pending invitation until it is accepted', () => {
        const result = assessContinuity(
            [active('owner'), { role: 'owner', status: 'invited', inviteExpiresAt: '2026-10-20T00:00:00Z' }],
            NOW,
        );
        expect(result).toMatchObject({ level: 'single_issuer', pendingInvites: 1 });
    });

    it('does not count an expired invitation as pending', () => {
        const result = assessContinuity(
            [active('owner'), { role: 'issuer', status: 'invited', inviteExpiresAt: '2026-10-01T00:00:00Z' }],
            NOW,
        );
        expect(result.pendingInvites).toBe(0);
    });

    it('ignores removed members', () => {
        expect(assessContinuity([active('owner'), { role: 'owner', status: 'deactivated' }], NOW).level).toBe(
            'single_issuer',
        );
    });

    it('notes a single owner when issuance is covered but member management is not', () => {
        expect(assessContinuity([active('owner'), active('issuer')], NOW)).toMatchObject({
            level: 'single_owner',
            activeIssuers: 2,
            activeOwners: 1,
        });
    });

    it('is healthy with two owners', () => {
        expect(assessContinuity([active('owner'), active('owner'), active('viewer')], NOW)).toMatchObject({
            level: 'healthy',
            activeIssuers: 2,
            activeOwners: 2,
            activeMembers: 3,
        });
    });

    it('maps the legacy role vocabulary onto the same capabilities', () => {
        // poc = owner, admin = issuer (see institutionMembership.ts).
        expect(assessContinuity([active('poc'), active('admin')], NOW)).toMatchObject({
            activeIssuers: 2,
            activeOwners: 1,
            level: 'single_owner',
        });
    });

    it('marks only issuance-threatening levels as at risk', () => {
        expect([...AT_RISK_LEVELS].sort()).toEqual(['no_issuers', 'single_issuer']);
    });
});

describe('isInviteExpired', () => {
    it('treats a missing expiry as not expired (legacy rows)', () => {
        expect(isInviteExpired(null, NOW)).toBe(false);
    });

    it('expires exactly at the deadline', () => {
        expect(isInviteExpired('2026-10-17T12:00:00Z', NOW)).toBe(true);
        expect(isInviteExpired('2026-10-17T12:00:01Z', NOW)).toBe(false);
    });
});
