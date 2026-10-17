'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TriangleAlert, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AT_RISK_LEVELS } from '@/lib/institutionContinuity';
import { useInstitutionTeam } from '@/hooks/useInstitutionTeam';

const TEAM_PATH = '/dashboard/team';

/**
 * Persistent warning shown across the institution console while fewer than
 * two people can issue credentials (Issue #307).
 *
 * Deliberately not dismissible: the risk it describes does not go away by
 * being acknowledged, only by a second member accepting an invitation. It is
 * hidden on the Team page itself, which explains the same thing in full.
 */
export function ContinuityBanner() {
    const pathname = usePathname();
    const { loading, continuity, members, canManage } = useInstitutionTeam();

    if (loading || !continuity || pathname === TEAM_PATH || !AT_RISK_LEVELS.has(continuity.level)) {
        return null;
    }

    const pending = members.filter((member) => member.status === 'invited');
    const noIssuers = continuity.level === 'no_issuers';

    return (
        <section
            aria-label="Team continuity"
            className={`mb-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
                noIssuers
                    ? 'border-destructive/30 bg-destructive/8'
                    : 'border-warning/30 bg-warning/10'
            }`}
        >
            <div className="flex items-start gap-3">
                <TriangleAlert
                    className={`mt-0.5 h-5 w-5 shrink-0 ${noIssuers ? 'text-destructive' : 'text-warning'}`}
                    aria-hidden="true"
                />
                <div className="text-sm">
                    <p className="font-semibold text-foreground">
                        {noIssuers
                            ? 'Nobody at your institution can issue credentials right now'
                            : 'Only one person can issue credentials for your institution'}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                        {noIssuers
                            ? 'Contact Acredia support to restore access.'
                            : "If they're locked out or leave, issuing and revoking stop until Acredia steps in."}{' '}
                        {pending.length > 0
                            ? `${pending.length === 1 ? 'An invitation is' : `${pending.length} invitations are`} pending — it counts once accepted.`
                            : canManage
                              ? 'Add a second member so someone can always act.'
                              : "Ask your institution's owner to add a second member."}
                    </p>
                </div>
            </div>
            {canManage && !noIssuers && (
                <Button asChild size="sm" className="shrink-0 self-start sm:self-center">
                    <Link href={TEAM_PATH}>
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        {pending.length > 0 ? 'View team' : 'Add a member'}
                    </Link>
                </Button>
            )}
        </section>
    );
}
