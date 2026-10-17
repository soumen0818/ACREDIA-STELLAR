'use client';

import { useMemo, useState } from 'react';
import { CircleCheck, Mail, RefreshCw, TriangleAlert, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
    CONTINUITY_LABELS,
    continuityBadgeClass,
    type ContinuityAssessment,
} from '@/lib/institutionContinuity';
import type { InstitutionMemberView } from '@/lib/institutionMembers';
import type { MemberRole } from '@/lib/institutionMembership';
import {
    notifyTeamChanged,
    TeamApiError,
    teamFetch,
    useInstitutionTeam,
} from '@/hooks/useInstitutionTeam';

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string; description: string }> = [
    {
        value: 'owner',
        label: 'Owner',
        description: 'Issues and revokes credentials, manages students, and adds or removes team members.',
    },
    {
        value: 'issuer',
        label: 'Issuer',
        description: 'Issues and revokes credentials and manages students.',
    },
    {
        value: 'viewer',
        label: 'Viewer',
        description: 'Read-only access to credentials, students and analytics.',
    },
];

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Owner', issuer: 'Issuer', viewer: 'Viewer' };

const SELECT_CLASS =
    'h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50';

const EMPTY_INVITE = { name: '', email: '', role: 'owner' as MemberRole };

function formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ member }: { member: InstitutionMemberView }) {
    const { label, className } =
        member.status === 'active'
            ? { label: 'Active', className: 'bg-success/12 text-success border-success/25' }
            : member.status === 'expired'
              ? { label: 'Invite expired', className: 'bg-destructive/12 text-destructive border-destructive/25' }
              : { label: 'Invited', className: 'bg-info/12 text-info border-info/25' };

    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}
        >
            {label}
        </span>
    );
}

/** What the continuity level means for this institution, in plain words. */
function ContinuitySummary({
    continuity,
    canManage,
    onInvite,
}: {
    continuity: ContinuityAssessment;
    canManage: boolean;
    onInvite: () => void;
}) {
    const { level, activeIssuers, activeOwners, pendingInvites } = continuity;
    const covered = level === 'healthy';

    const message: Record<typeof level, string> = {
        no_issuers:
            'Nobody active can issue or revoke credentials. Contact Acredia support to restore access.',
        single_issuer:
            "Only one person can issue credentials. If they're locked out or leave, issuing and revoking stop until Acredia steps in. Add a second member — ideally as an owner.",
        single_owner:
            'More than one person can issue, but only one can manage the team. Consider making a second member an owner, so adding or removing people never needs Acredia.',
        healthy: 'At least two people can issue credentials and manage the team. No single absence stops your institution.',
    };

    return (
        <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    {covered ? (
                        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                    )}
                    <div className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-foreground">Continuity</h2>
                            <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${continuityBadgeClass(level)}`}
                            >
                                {CONTINUITY_LABELS[level]}
                            </span>
                        </div>
                        <p className="mt-1.5 text-muted-foreground">{message[level]}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            {activeIssuers} {activeIssuers === 1 ? 'person' : 'people'} can issue ·{' '}
                            {activeOwners} {activeOwners === 1 ? 'owner' : 'owners'}
                            {pendingInvites > 0 && ` · ${pendingInvites} pending ${pendingInvites === 1 ? 'invitation' : 'invitations'} (counted once accepted)`}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Issuing on-chain also needs your institution&apos;s Stellar wallet. Make sure a
                            second person can sign with it too — Acredia can neither see nor recover it.
                        </p>
                    </div>
                </div>
                {canManage && !covered && level !== 'no_issuers' && (
                    <Button size="sm" className="shrink-0" onClick={onInvite}>
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        Invite a member
                    </Button>
                )}
            </div>
        </Card>
    );
}

type PendingAction =
    | { kind: 'remove'; member: InstitutionMemberView }
    | { kind: 'role'; member: InstitutionMemberView; role: MemberRole };

export function TeamManager() {
    const { loading, error, members, continuity, canManage, refresh } = useInstitutionTeam();

    const [inviteOpen, setInviteOpen] = useState(false);
    const [invite, setInvite] = useState(EMPTY_INVITE);
    const [inviteError, setInviteError] = useState('');
    const [inviting, setInviting] = useState(false);

    const [pending, setPending] = useState<PendingAction | null>(null);
    const [pendingError, setPendingError] = useState('');
    const [working, setWorking] = useState(false);
    const [resendingId, setResendingId] = useState<string | null>(null);

    const sortedMembers = useMemo(
        () =>
            [...members].sort((a, b) => {
                const rank = (m: InstitutionMemberView) => (m.status === 'active' ? 0 : 1);
                return rank(a) - rank(b);
            }),
        [members],
    );

    const openInvite = () => {
        setInvite(EMPTY_INVITE);
        setInviteError('');
        setInviteOpen(true);
    };

    const submitInvite = async (event: React.FormEvent) => {
        event.preventDefault();
        setInviteError('');
        setInviting(true);
        try {
            const result = await teamFetch<{ message: string }>('/api/institution/members', {
                method: 'POST',
                body: JSON.stringify(invite),
            });
            toast.success(result.message);
            setInviteOpen(false);
            notifyTeamChanged();
        } catch (err) {
            setInviteError(err instanceof Error ? err.message : 'Failed to send the invitation');
        } finally {
            setInviting(false);
        }
    };

    const resend = async (member: InstitutionMemberView) => {
        setResendingId(member.id);
        try {
            const result = await teamFetch<{ message: string }>(
                `/api/institution/members/${member.id}/resend`,
                { method: 'POST' },
            );
            toast.success(result.message);
            notifyTeamChanged();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to resend the invitation');
        } finally {
            setResendingId(null);
        }
    };

    const confirmPending = async () => {
        if (!pending) return;
        setPendingError('');
        setWorking(true);
        try {
            if (pending.kind === 'remove') {
                await teamFetch(`/api/institution/members/${pending.member.id}`, { method: 'DELETE' });
                toast.success(
                    pending.member.isYou
                        ? 'You left the team.'
                        : pending.member.status === 'active'
                          ? `${pending.member.name ?? pending.member.email ?? 'Member'} was removed.`
                          : 'Invitation withdrawn.',
                );
            } else {
                await teamFetch(`/api/institution/members/${pending.member.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ role: pending.role }),
                });
                toast.success(`Role changed to ${ROLE_LABELS[pending.role]}.`);
            }
            setPending(null);
            notifyTeamChanged();
            if (pending.kind === 'remove' && pending.member.isYou) {
                window.location.assign('/dashboard');
            }
        } catch (err) {
            // The guard's own explanation — e.g. "This is the only owner…" —
            // is the most useful thing to show, so it is shown verbatim.
            setPendingError(
                err instanceof TeamApiError || err instanceof Error ? err.message : 'Failed to update the member',
            );
        } finally {
            setWorking(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }

    if (error || !continuity) {
        return (
            <Card className="border-destructive/25 bg-destructive/8 p-6">
                <p className="text-sm font-semibold text-destructive">{error ?? 'Failed to load your team'}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>
                    Try again
                </Button>
            </Card>
        );
    }

    const pendingIsLastRisk =
        pending?.member.status === 'active' &&
        (pending.kind === 'remove' || pending.role !== 'owner');

    return (
        <div className="space-y-6">
            <ContinuitySummary continuity={continuity} canManage={canManage} onInvite={openInvite} />

            <Card className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Members</h2>
                        <p className="text-xs text-muted-foreground">
                            {canManage
                                ? 'Invitations are emailed directly to the person you invite and expire after 7 days.'
                                : "Only your institution's owners can change the team."}
                        </p>
                    </div>
                    {canManage && (
                        <Button size="sm" variant="outline" onClick={openInvite}>
                            <UserPlus className="h-4 w-4" aria-hidden="true" />
                            Invite
                        </Button>
                    )}
                </div>

                <ul className="divide-y divide-border">
                    {sortedMembers.map((member) => (
                        <li
                            key={member.id}
                            className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                        >
                            <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">
                                    {member.name ?? member.email ?? 'Unnamed member'}
                                    {member.isYou && (
                                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                                    )}
                                </p>
                                {member.name && member.email && (
                                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                                )}
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <StatusBadge member={member} />
                                    {member.status === 'active'
                                        ? <span>Joined {formatDate(member.acceptedAt)}</span>
                                        : <span>Invitation {member.status === 'expired' ? 'expired' : 'expires'} {formatDate(member.inviteExpiresAt)}</span>}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {canManage ? (
                                    <>
                                        <Label htmlFor={`role-${member.id}`} className="sr-only">
                                            Role for {member.name ?? member.email ?? 'member'}
                                        </Label>
                                        <select
                                            id={`role-${member.id}`}
                                            className={SELECT_CLASS}
                                            value={member.role}
                                            onChange={(event) => {
                                                setPendingError('');
                                                setPending({
                                                    kind: 'role',
                                                    member,
                                                    role: event.target.value as MemberRole,
                                                });
                                            }}
                                        >
                                            {ROLE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {member.status !== 'active' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => void resend(member)}
                                                disabled={resendingId === member.id}
                                            >
                                                <Mail className="h-4 w-4" aria-hidden="true" />
                                                {resendingId === member.id ? 'Sending…' : 'Resend'}
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => {
                                                setPendingError('');
                                                setPending({ kind: 'remove', member });
                                            }}
                                        >
                                            <UserMinus className="h-4 w-4" aria-hidden="true" />
                                            {member.isYou
                                                ? 'Leave team'
                                                : member.status === 'active'
                                                  ? 'Remove'
                                                  : 'Withdraw'}
                                        </Button>
                                    </>
                                ) : (
                                    <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-foreground">
                                        {ROLE_LABELS[member.role]}
                                    </span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>

                <div className="flex justify-end border-t border-border px-5 py-3">
                    <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Refresh
                    </Button>
                </div>
            </Card>

            <Dialog open={inviteOpen} onOpenChange={(open) => !inviting && setInviteOpen(open)}>
                <DialogContent>
                    <form onSubmit={submitInvite} className="space-y-5">
                        <DialogHeader>
                            <DialogTitle>Invite a team member</DialogTitle>
                            <DialogDescription>
                                We email them a link to set their own password. Nobody else — including you —
                                ever sees it.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                            <Label htmlFor="member-name">Full name</Label>
                            <Input
                                id="member-name"
                                value={invite.name}
                                onChange={(event) => setInvite({ ...invite, name: event.target.value })}
                                required
                                minLength={2}
                                maxLength={100}
                                autoComplete="off"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="member-email">Work email</Label>
                            <Input
                                id="member-email"
                                type="email"
                                value={invite.email}
                                onChange={(event) => setInvite({ ...invite, email: event.target.value })}
                                required
                                maxLength={254}
                                autoComplete="off"
                            />
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="text-sm font-medium text-foreground">Role</legend>
                            {ROLE_OPTIONS.map((option) => (
                                <div
                                    key={option.value}
                                    className={cn(
                                        'flex items-start gap-3 rounded-lg border p-3 text-sm',
                                        invite.role === option.value
                                            ? 'border-primary/40 bg-primary/5'
                                            : 'border-border',
                                    )}
                                >
                                    <input
                                        id={`member-role-${option.value}`}
                                        type="radio"
                                        name="member-role"
                                        value={option.value}
                                        checked={invite.role === option.value}
                                        onChange={() => setInvite({ ...invite, role: option.value })}
                                        aria-describedby={`member-role-${option.value}-description`}
                                        className="mt-1"
                                    />
                                    <div>
                                        <label
                                            htmlFor={`member-role-${option.value}`}
                                            className="cursor-pointer font-semibold text-foreground"
                                        >
                                            {option.label}
                                            {option.value === 'owner' ? ' — recommended for continuity' : ''}
                                        </label>
                                        <p
                                            id={`member-role-${option.value}-description`}
                                            className="mt-0.5 text-muted-foreground"
                                        >
                                            {option.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </fieldset>

                        {inviteError && (
                            <p
                                className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                                role="alert"
                            >
                                {inviteError}
                            </p>
                        )}

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setInviteOpen(false)}
                                disabled={inviting}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={inviting}>
                                {inviting ? 'Sending…' : 'Send invitation'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={pending !== null} onOpenChange={(open) => !open && !working && setPending(null)}>
                <DialogContent>
                    {pending && (
                        <>
                            <DialogHeader>
                                <DialogTitle>
                                    {pending.kind === 'role'
                                        ? `Change role to ${ROLE_LABELS[pending.role]}?`
                                        : pending.member.isYou
                                          ? 'Leave this institution?'
                                          : pending.member.status === 'active'
                                            ? 'Remove this member?'
                                            : 'Withdraw this invitation?'}
                                </DialogTitle>
                                <DialogDescription>
                                    {pending.kind === 'role'
                                        ? `${pending.member.name ?? pending.member.email} will become ${ROLE_LABELS[pending.role].toLowerCase()}: ${ROLE_OPTIONS.find((o) => o.value === pending.role)?.description}`
                                        : pending.member.isYou
                                          ? 'You will lose access immediately. Credentials you issued stay valid.'
                                          : pending.member.status === 'active'
                                            ? `${pending.member.name ?? pending.member.email} will lose access immediately. Credentials they issued stay valid.`
                                            : 'The emailed link will stop working.'}
                                </DialogDescription>
                            </DialogHeader>

                            {pendingIsLastRisk && continuity.level !== 'healthy' && (
                                <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
                                    Your team is already thin. Acredia will refuse this if it would leave nobody
                                    who can issue or manage the team.
                                </p>
                            )}

                            {pendingError && (
                                <p
                                    className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                                    role="alert"
                                >
                                    {pendingError}
                                </p>
                            )}

                            <DialogFooter>
                                <Button variant="outline" onClick={() => setPending(null)} disabled={working}>
                                    Cancel
                                </Button>
                                <Button
                                    variant={pending.kind === 'remove' ? 'destructive' : 'default'}
                                    onClick={() => void confirmPending()}
                                    disabled={working}
                                >
                                    {working
                                        ? 'Saving…'
                                        : pending.kind === 'role'
                                          ? 'Change role'
                                          : pending.member.isYou
                                            ? 'Leave team'
                                            : pending.member.status === 'active'
                                              ? 'Remove'
                                              : 'Withdraw'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
