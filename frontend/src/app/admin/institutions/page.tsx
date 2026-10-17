'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    Building2,
    Check,
    Copy,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConsolePage } from '@/components/console/ConsoleShell';
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
import { captureException } from '@/lib/debug';
import { AT_RISK_LEVELS, CONTINUITY_LABELS, continuityBadgeClass } from '@/lib/institutionContinuity';
import {
    adminFetch,
    formatDate,
    onboardingBadgeClass,
    onboardingLabel,
    shortenAddress,
    statusBadgeClass,
    type AdminInstitutionSummary,
} from '@/lib/adminApi';

function StatusBadge({ status }: { status: string }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(status)}`}
        >
            {status}
        </span>
    );
}

function ContinuityBadge({ institution }: { institution: AdminInstitutionSummary }) {
    if (!institution.continuity) return <span className="text-xs text-muted-foreground">—</span>;
    const { level, activeIssuers } = institution.continuity;
    return (
        <span className="inline-flex flex-col gap-0.5">
            <span
                className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${continuityBadgeClass(level)}`}
            >
                {CONTINUITY_LABELS[level]}
            </span>
            <span className="text-xs text-muted-foreground">
                {activeIssuers} can issue
            </span>
        </span>
    );
}

const RISK_ORDER = { no_issuers: 0, single_issuer: 1, single_owner: 2, healthy: 3 } as const;

/**
 * Institutions that stop issuing if one person is unavailable — or already
 * have (Issue #307). Fed by live membership and by the erasure audit signal.
 */
function ContinuityRiskPanel({ institutions }: { institutions: AdminInstitutionSummary[] }) {
    const atRisk = institutions
        .filter((institution) => institution.continuity && AT_RISK_LEVELS.has(institution.continuity.level))
        .sort(
            (a, b) =>
                RISK_ORDER[a.continuity!.level] - RISK_ORDER[b.continuity!.level] ||
                a.name.localeCompare(b.name),
        );

    if (institutions.length === 0) return null;

    if (atRisk.length === 0) {
        return (
            <Card className="mb-6 flex items-center gap-3 p-4 text-sm">
                <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <span className="text-muted-foreground">
                    Every institution has at least two people who can issue credentials.
                </span>
            </Card>
        );
    }

    return (
        <Card className="mb-6 overflow-hidden" aria-labelledby="continuity-risk-heading">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                <div>
                    <h2 id="continuity-risk-heading" className="text-base font-semibold text-foreground">
                        Continuity risk ({atRisk.length})
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Institutions where one person being locked out or leaving stops issuance. Owners
                        can fix this themselves from their Team page; nudge them before it matters.
                    </p>
                </div>
            </div>
            <ul className="divide-y divide-border">
                {atRisk.map((institution) => {
                    const continuity = institution.continuity!;
                    return (
                        <li key={institution.id}>
                            <Link
                                href={`/admin/institutions/${institution.id}`}
                                className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-foreground">
                                        {institution.name}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {continuity.level === 'no_issuers'
                                            ? institution.memberLossAt
                                                ? `Nobody can issue since an account erasure on ${formatDate(institution.memberLossAt)} — provision a new member.`
                                                : 'Nobody active can issue — provision a new member.'
                                            : `One person can issue${continuity.pendingInvites > 0 ? ` · ${continuity.pendingInvites} invitation pending` : ' · no invitation sent'}`}
                                    </span>
                                </span>
                                <span
                                    className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${continuityBadgeClass(continuity.level)}`}
                                >
                                    {CONTINUITY_LABELS[continuity.level]}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

function OnboardingBadge({ institution }: { institution: AdminInstitutionSummary }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${onboardingBadgeClass(institution.onboardingState)}`}
        >
            {onboardingLabel(institution.onboardingState)}
        </span>
    );
}

const EMPTY_FORM = {
    name: '',
    pocName: '',
    pocEmail: '',
    walletAddress: '',
    country: '',
    accreditationRef: '',
    internalNotes: '',
};

function InstitutionsContent() {
    const [institutions, setInstitutions] = useState<AdminInstitutionSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [atRiskOnly, setAtRiskOnly] = useState(false);

    // "Add institution" provisioning flow
    const [addOpen, setAddOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formError, setFormError] = useState('');
    const [invite, setInvite] = useState<{
        institutionName: string;
        link: string | null;
        expiresAt: string | null;
    } | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(async (silent = false) => {
        try {
            if (silent) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const data = await adminFetch<{ institutions: AdminInstitutionSummary[] }>(
                '/api/admin/institutions',
            );
            setInstitutions(data.institutions);
            setError('');
        } catch (err) {
            captureException(err, { context: 'adminInstitutionsList' });
            const message = err instanceof Error ? err.message : 'Failed to load institutions';
            setError(message);
            if (!silent) {
                toast.error(message);
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const updateField = (field: keyof typeof EMPTY_FORM, value: string) => {
        setForm((previous) => ({ ...previous, [field]: value }));
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError('');
        setSubmitting(true);

        try {
            const payload = {
                name: form.name.trim(),
                pocName: form.pocName.trim(),
                pocEmail: form.pocEmail.trim(),
                walletAddress: form.walletAddress.trim(),
                country: form.country.trim() || undefined,
                accreditationRef: form.accreditationRef.trim() || undefined,
                internalNotes: form.internalNotes.trim() || undefined,
            };

            const data = await adminFetch<{
                institution: { id: string; name: string };
                inviteLink: string | null;
                inviteExpiresAt: string | null;
                message: string;
            }>('/api/admin/institutions', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            setInvite({
                institutionName: data.institution.name,
                link: data.inviteLink,
                expiresAt: data.inviteExpiresAt,
            });
            setCopied(false);
            setForm(EMPTY_FORM);
            toast.success(data.message);
            load(true);
        } catch (err) {
            captureException(err, { context: 'adminCreateInstitution' });
            const message = err instanceof Error ? err.message : 'Failed to create institution';
            setFormError(message);
            toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopyInvite = async () => {
        if (!invite?.link) return;

        try {
            await navigator.clipboard.writeText(invite.link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Could not copy the link. Select it and copy manually.');
        }
    };

    const closeAddDialog = (open: boolean) => {
        setAddOpen(open);
        if (!open) {
            setForm(EMPTY_FORM);
            setFormError('');
            setInvite(null);
            setCopied(false);
        }
    };

    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        return institutions.filter(
            (institution) =>
                (!atRiskOnly ||
                    (institution.continuity && AT_RISK_LEVELS.has(institution.continuity.level))) &&
                (!term ||
                    institution.name.toLowerCase().includes(term) ||
                    institution.email.toLowerCase().includes(term) ||
                    (institution.walletAddress ?? '').toLowerCase().includes(term)),
        );
    }, [institutions, query, atRiskOnly]);

    return (
        <ConsolePage
            title="Institutions"
            subtitle="Every organisation registered on Acredia"
            actions={
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => load(true)}
                        disabled={refreshing || loading}
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Add institution
                    </Button>
                </div>
            }
        >
            {!loading && !error && <ContinuityRiskPanel institutions={institutions} />}

            <Card className="mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search by name, email, or wallet address"
                        className="pl-9"
                        aria-label="Search institutions"
                    />
                </div>
                <Button
                    variant={atRiskOnly ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={atRiskOnly}
                    onClick={() => setAtRiskOnly((value) => !value)}
                >
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    At risk only
                </Button>
            </Card>

            {loading ? (
                <div className="space-y-3">
                    {[0, 1, 2].map((index) => (
                        <Card key={index} className="p-5">
                            <Skeleton className="h-5 w-48" />
                            <Skeleton className="mt-3 h-4 w-64" />
                        </Card>
                    ))}
                </div>
            ) : error ? (
                <Card className="border-destructive/25 bg-destructive/8 p-6">
                    <p className="text-sm font-semibold text-destructive">{error}</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => load()}>
                        Try again
                    </Button>
                </Card>
            ) : filtered.length === 0 ? (
                <Card className="p-10 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                        <Building2 className="h-6 w-6" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">
                        {institutions.length === 0
                            ? 'No institutions registered yet'
                            : 'No institutions match your search'}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {institutions.length === 0
                            ? 'Provision the first one with "Add institution" to issue its POC an invite.'
                            : 'Try a different name, email, or wallet address.'}
                    </p>
                </Card>
            ) : (
                <>
                    {/* Desktop: table. Mobile: stacked cards (below). */}
                    <Card className="hidden overflow-hidden lg:block">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-border bg-secondary/40">
                                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                                        <th className="px-5 py-3 font-semibold">Institution</th>
                                        <th className="px-5 py-3 font-semibold">Status</th>
                                        <th className="px-5 py-3 font-semibold">Onboarding</th>
                                        <th className="px-5 py-3 font-semibold">Team</th>
                                        <th className="px-5 py-3 font-semibold">Wallet</th>
                                        <th className="px-5 py-3 font-semibold">Credentials</th>
                                        <th className="px-5 py-3 font-semibold">Registered</th>
                                        <th className="px-5 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {filtered.map((institution) => (
                                        <tr
                                            key={institution.id}
                                            className="transition-colors hover:bg-secondary/40"
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-semibold text-foreground">
                                                    {institution.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {institution.email}
                                                </p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <StatusBadge status={institution.status} />
                                            </td>
                                            <td className="px-5 py-4">
                                                <OnboardingBadge institution={institution} />
                                            </td>
                                            <td className="px-5 py-4">
                                                <ContinuityBadge institution={institution} />
                                            </td>
                                            <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                                                {shortenAddress(institution.walletAddress)}
                                            </td>
                                            <td className="px-5 py-4 text-foreground">
                                                {institution.credentialCount}
                                                <span className="text-xs text-muted-foreground">
                                                    {' '}
                                                    ({institution.activeCredentialCount} active)
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-muted-foreground">
                                                {formatDate(institution.createdAt)}
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <Link
                                                    href={`/admin/institutions/${institution.id}`}
                                                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                                                >
                                                    View
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <div className="space-y-3 lg:hidden">
                        {filtered.map((institution) => (
                            <Link
                                key={institution.id}
                                href={`/admin/institutions/${institution.id}`}
                                className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-foreground">
                                            {institution.name}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {institution.email}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                                        <StatusBadge status={institution.status} />
                                        <OnboardingBadge institution={institution} />
                                    </div>
                                </div>
                                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                    <div className="col-span-2">
                                        <dt className="text-muted-foreground">Team</dt>
                                        <dd className="mt-0.5">
                                            <ContinuityBadge institution={institution} />
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-muted-foreground">Wallet</dt>
                                        <dd className="mt-0.5 font-mono text-foreground">
                                            {shortenAddress(institution.walletAddress)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-muted-foreground">Credentials</dt>
                                        <dd className="mt-0.5 text-foreground">
                                            {institution.credentialCount} (
                                            {institution.activeCredentialCount} active)
                                        </dd>
                                    </div>
                                </dl>
                            </Link>
                        ))}
                    </div>
                </>
            )}

            <Dialog open={addOpen} onOpenChange={closeAddDialog}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Add institution</DialogTitle>
                        <DialogDescription>
                            Creates the institution as pending and provisions its POC with no
                            password. The POC sets their own password from the invite link. This
                            does not authorize the wallet on-chain — do that separately from
                            Authorize issuer.
                        </DialogDescription>
                    </DialogHeader>

                    {invite ? (
                        <div className="space-y-4 py-2">
                            <div className="rounded-lg border border-success/25 bg-success/8 px-4 py-3 text-sm text-success">
                                {invite.institutionName} was provisioned.
                            </div>

                            {invite.link ? (
                                <div className="space-y-2">
                                    <Label htmlFor="invite-link">
                                        Single-use invite link
                                        {invite.expiresAt
                                            ? ` · expires ${formatDate(invite.expiresAt)}`
                                            : ''}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="invite-link"
                                            readOnly
                                            value={invite.link}
                                            className="h-9 bg-background font-mono text-xs"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={handleCopyInvite}
                                            className="h-9 shrink-0 gap-1.5"
                                        >
                                            {copied ? (
                                                <>
                                                    <Check className="h-3.5 w-3.5 text-success" />
                                                    Copied
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="h-3.5 w-3.5" />
                                                    Copy
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Supabase also emails this link. Copy it now if mail is
                                        delayed — you can regenerate it from the institution page,
                                        which invalidates this one.
                                    </p>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning">
                                    The invite link could not be generated. Regenerate it from the
                                    institution page.
                                </div>
                            )}

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => closeAddDialog(false)}
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    ) : (
                        <form onSubmit={handleCreate} className="space-y-4 py-2">
                            <div className="space-y-2">
                                <Label htmlFor="institution-name">Institution name</Label>
                                <Input
                                    id="institution-name"
                                    value={form.name}
                                    onChange={(event) => updateField('name', event.target.value)}
                                    placeholder="University of Example"
                                    required
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="poc-name">POC name</Label>
                                    <Input
                                        id="poc-name"
                                        value={form.pocName}
                                        onChange={(event) =>
                                            updateField('pocName', event.target.value)
                                        }
                                        placeholder="Registrar's full name"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="poc-email">POC email</Label>
                                    <Input
                                        id="poc-email"
                                        type="email"
                                        value={form.pocEmail}
                                        onChange={(event) =>
                                            updateField('pocEmail', event.target.value)
                                        }
                                        placeholder="registrar@example.edu"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="wallet-address">Issuer wallet address</Label>
                                <Input
                                    id="wallet-address"
                                    value={form.walletAddress}
                                    onChange={(event) =>
                                        updateField('walletAddress', event.target.value)
                                    }
                                    placeholder="G…"
                                    className="font-mono text-xs"
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Recorded now, authorized on-chain later.
                                </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="country">Country or region (optional)</Label>
                                    <Input
                                        id="country"
                                        value={form.country}
                                        onChange={(event) =>
                                            updateField('country', event.target.value)
                                        }
                                        placeholder="India"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="accreditation-ref">
                                        Accreditation ref (optional)
                                    </Label>
                                    <Input
                                        id="accreditation-ref"
                                        value={form.accreditationRef}
                                        onChange={(event) =>
                                            updateField('accreditationRef', event.target.value)
                                        }
                                        placeholder="NAAC A++"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="internal-notes">Internal notes (optional)</Label>
                                <Input
                                    id="internal-notes"
                                    value={form.internalNotes}
                                    onChange={(event) =>
                                        updateField('internalNotes', event.target.value)
                                    }
                                    placeholder="Basis for provisioning, who requested it"
                                />
                            </div>

                            {formError && (
                                <div
                                    className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                                    role="alert"
                                >
                                    {formError}
                                </div>
                            )}

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => closeAddDialog(false)}
                                    disabled={submitting}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? 'Provisioning…' : 'Create and invite'}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </ConsolePage>
    );
}

export default function AdminInstitutionsPage() {
    return (
            <InstitutionsContent />
    );
}
