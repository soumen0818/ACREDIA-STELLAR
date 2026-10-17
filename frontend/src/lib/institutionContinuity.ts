import { canManageMembers, canWrite, type InstitutionRole } from './institutionMembership';

/**
 * Whether an institution can keep operating if one person is unavailable
 * (Issue #307).
 *
 * - `no_issuers` — nobody active can issue or manage members. Issuance has
 *   stopped until an Acredia admin provisions someone.
 * - `single_issuer` — exactly one person can issue. If they are locked out or
 *   leave, issuance stops. This is the single-point-of-contact risk.
 * - `single_owner` — two or more people can issue, but only one can manage
 *   members. Issuance survives that owner leaving; adding or removing members
 *   would then need an Acredia admin.
 * - `healthy` — at least two issuers and at least two owners.
 *
 * Only `active` members count. A pending invitation is progress, not
 * continuity: the invitee has not proven they can sign in.
 */
export type ContinuityLevel = 'no_issuers' | 'single_issuer' | 'single_owner' | 'healthy';

export interface ContinuityMember {
    role: InstitutionRole | string;
    status: string;
    inviteExpiresAt?: string | null;
}

export interface ContinuityAssessment {
    level: ContinuityLevel;
    /** Active members who may issue (owner, issuer and legacy equivalents). */
    activeIssuers: number;
    /** Active members who may manage members. */
    activeOwners: number;
    activeMembers: number;
    /** Invitations not yet accepted and not yet expired. */
    pendingInvites: number;
}

/** Levels that put issuance itself at risk — what the console banner and admin risk list show. */
export const AT_RISK_LEVELS: ReadonlySet<ContinuityLevel> = new Set(['no_issuers', 'single_issuer']);

/** Short labels, shared by the institution and admin consoles so both say the same thing. */
export const CONTINUITY_LABELS: Record<ContinuityLevel, string> = {
    no_issuers: 'No one can issue',
    single_issuer: 'Single point of contact',
    single_owner: 'One owner',
    healthy: 'Covered',
};

/** Badge classes in the design system's status palette. */
export function continuityBadgeClass(level: ContinuityLevel): string {
    switch (level) {
        case 'no_issuers':
            return 'bg-destructive/12 text-destructive border-destructive/25';
        case 'single_issuer':
            // /6, not the usual /12: amber text on a /12 tint measures 4.26:1,
            // under WCAG AA's 4.5:1 for 12px text; /6 gives 4.63:1.
            return 'bg-warning/6 text-warning border-warning/25';
        case 'single_owner':
            return 'bg-info/12 text-info border-info/25';
        default:
            return 'bg-success/12 text-success border-success/25';
    }
}

export function isInviteExpired(inviteExpiresAt: string | null | undefined, now: Date): boolean {
    if (!inviteExpiresAt) return false;
    const expiresAt = new Date(inviteExpiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

export function assessContinuity(
    members: readonly ContinuityMember[],
    now: Date = new Date(),
): ContinuityAssessment {
    let activeIssuers = 0;
    let activeOwners = 0;
    let activeMembers = 0;
    let pendingInvites = 0;

    for (const member of members) {
        const role = member.role as InstitutionRole;

        if (member.status === 'active') {
            activeMembers += 1;
            if (canWrite(role)) activeIssuers += 1;
            if (canManageMembers(role)) activeOwners += 1;
        } else if (member.status === 'invited' && !isInviteExpired(member.inviteExpiresAt, now)) {
            pendingInvites += 1;
        }
    }

    const level: ContinuityLevel =
        activeIssuers === 0
            ? 'no_issuers'
            : activeIssuers === 1
              ? 'single_issuer'
              : activeOwners < 2
                ? 'single_owner'
                : 'healthy';

    return { level, activeIssuers, activeOwners, activeMembers, pendingInvites };
}
