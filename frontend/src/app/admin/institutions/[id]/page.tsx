'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
    ArrowLeft,
    Building2,
    Check,
    Copy,
    FileText,
    History,
    KeyRound,
    Mail,
    ShieldAlert,
    ShieldCheck,
    UserCheck,
    UserMinus,
    UserPlus,
    Users,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConsoleShell } from '@/components/console/ConsoleShell';
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
    DialogTrigger,
} from '@/components/ui/dialog';
import { captureException } from '@/lib/debug';
import {
    adminFetch,
    formatDate,
    statusBadgeClass,
    type AdminAuditLog,
    type AdminInstitutionCredential,
    type AdminInstitutionSummary,
} from '@/lib/adminApi';
import { CONSOLE_NAV } from '@/lib/consoleNav';
import { ProtectedRoute } from '@/contexts/AuthContext';

interface DetailResponse {
    institution: AdminInstitutionSummary;
    auditLogs?: AdminAuditLog[];
    credentials: AdminInstitutionCredential[];
}

function DetailRow({
    icon: Icon,
    label,
    children,
}: {
    icon: typeof Mail;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </p>
                <div className="mt-1 break-all text-sm text-foreground">{children}</div>
            </div>
        </div>
    );
}

function InstitutionDetailContent() {
    const params = useParams<{ id: string }>();
    const institutionId = params?.id;

    const [data, setData] = useState<DetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Fallback Link Generation State
    const [generatingLink, setGeneratingLink] = useState(false);
    const [generatedLink, setGeneratedLink] = useState<{
        url: string;
        type: string;
        expiresInHours: number;
    } | null>(null);
    const [copiedLink, setCopiedLink] = useState(false);

    // POC Handover Dialog & Form State
    const [handoverOpen, setHandoverOpen] = useState(false);
    const [handoverSubmitting, setHandoverSubmitting] = useState(false);
    const [handoverForm, setHandoverForm] = useState({
        newPocName: '',
        newPocEmail: '',
        requesterEmail: '',
        verificationMethod: 'Institutional domain email verification',
        notes: '',
    });

    const load = useCallback(async () => {
        if (!institutionId) return;

        try {
            setLoading(true);
            const response = await adminFetch<DetailResponse>(
                `/api/admin/institutions/${institutionId}`,
            );
            setData(response);
            setError('');
        } catch (err) {
            captureException(err, { context: 'adminInstitutionDetail' });
            const message = err instanceof Error ? err.message : 'Failed to load institution';
            setError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [institutionId]);

    useEffect(() => {
        load();
    }, [load]);

    const handleGenerateLink = async (type: 'recovery' | 'invite') => {
        if (!institutionId) return;

        try {
            setGeneratingLink(true);
            setCopiedLink(false);

            const result = await adminFetch<{
                success: boolean;
                link: string;
                type: string;
                expiresInHours: number;
                message: string;
            }>(`/api/admin/institutions/${institutionId}/recovery-link`, {
                method: 'POST',
                body: JSON.stringify({ type }),
            });

            setGeneratedLink({
                url: result.link,
                type: result.type,
                expiresInHours: result.expiresInHours,
            });

            toast.success(result.message || 'Direct access link generated successfully');
            // Refresh audit logs
            load();
        } catch (err) {
            captureException(err, { context: 'generateRecoveryLink' });
            const message = err instanceof Error ? err.message : 'Failed to generate link';
            toast.error(message);
        } finally {
            setGeneratingLink(false);
        }
    };

    const handleCopyLink = async () => {
        if (!generatedLink?.url) return;
        try {
            await navigator.clipboard.writeText(generatedLink.url);
            setCopiedLink(true);
            toast.success('Link copied to clipboard');
            setTimeout(() => setCopiedLink(false), 3000);
        } catch {
            toast.error('Failed to copy link to clipboard');
        }
    };

    const handlePocHandoverSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!institutionId) return;

        if (!handoverForm.newPocName.trim() || !handoverForm.newPocEmail.trim()) {
            toast.error('Please provide the new POC name and email');
            return;
        }

        if (!handoverForm.requesterEmail.trim()) {
            toast.error('Please specify the requester email for the audit record');
            return;
        }

        try {
            setHandoverSubmitting(true);

            const result = await adminFetch<{
                success: boolean;
                message: string;
                inviteLink?: string;
            }>(`/api/admin/institutions/${institutionId}/poc-handover`, {
                method: 'POST',
                body: JSON.stringify(handoverForm),
            });

            toast.success(result.message || 'POC handover completed successfully');
            setHandoverOpen(false);

            if (result.inviteLink) {
                setGeneratedLink({
                    url: result.inviteLink,
                    type: 'recovery',
                    expiresInHours: 24,
                });
            }

            // Reset form and reload institution data
            setHandoverForm({
                newPocName: '',
                newPocEmail: '',
                requesterEmail: '',
                verificationMethod: 'Institutional domain email verification',
                notes: '',
            });

            await load();
        } catch (err) {
            captureException(err, { context: 'adminPocHandoverSubmit' });
            const message = err instanceof Error ? err.message : 'Failed to complete POC handover';
            toast.error(message);
        } finally {
            setHandoverSubmitting(false);
        }
    };

    const institution = data?.institution;
    const poc = institution?.poc;
    const auditLogs = data?.auditLogs ?? [];

    return (
        <ConsoleShell
            nav={CONSOLE_NAV.admin}
            title={institution?.name ?? 'Institution'}
            subtitle={institution?.email ?? 'Institution details'}
            actions={
                <Button asChild variant="outline" size="sm">
                    <Link href="/admin/institutions">
                        <ArrowLeft className="h-4 w-4" />
                        All institutions
                    </Link>
                </Button>
            }
        >
            {loading ? (
                <div className="space-y-4">
                    <Card className="p-6">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="mt-4 h-4 w-72" />
                        <Skeleton className="mt-2 h-4 w-56" />
                    </Card>
                    <Card className="p-6">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="mt-4 h-4 w-full" />
                    </Card>
                </div>
            ) : error || !institution ? (
                <Card className="border-destructive/25 bg-destructive/8 p-6">
                    <p className="text-sm font-semibold text-destructive">
                        {error || 'Institution not found'}
                    </p>
                    <div className="mt-4 flex gap-2">
                        <Button variant="outline" size="sm" onClick={load}>
                            Try again
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                            <Link href="/admin/institutions">Back to list</Link>
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="space-y-6">
                    {/* Institution Overview */}
                    <Card className="p-6">
                        <div className="mb-6 flex flex-wrap items-center gap-3">
                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <Building2 className="h-5 w-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <h2 className="truncate text-lg font-bold text-foreground">
                                    {institution.name}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    Registered {formatDate(institution.createdAt)}
                                </p>
                            </div>
                            <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(institution.status)}`}
                            >
                                {institution.status}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            <DetailRow icon={Mail} label="Contact / POC Email">
                                {institution.email}
                            </DetailRow>
                            <DetailRow icon={Wallet} label="Wallet address">
                                {institution.walletAddress ? (
                                    <span className="font-mono text-xs">
                                        {institution.walletAddress}
                                    </span>
                                ) : (
                                    <span className="text-warning">Not linked</span>
                                )}
                            </DetailRow>
                            <DetailRow icon={FileText} label="Authorization transaction">
                                {institution.authorizationTxHash ? (
                                    <span className="font-mono text-xs">
                                        {institution.authorizationTxHash}
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">
                                        Not authorized on-chain
                                    </span>
                                )}
                            </DetailRow>
                            <DetailRow icon={Building2} label="Verified">
                                {institution.verified ? (
                                    <span className="text-success">Yes</span>
                                ) : (
                                    <span className="text-warning">No</span>
                                )}
                            </DetailRow>
                        </div>
                    </Card>

                    {/* POC & Account Recovery Management Card */}
                    <Card className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <UserCheck className="h-5 w-5" />
                                </span>
                                <div>
                                    <h3 className="text-base font-semibold text-foreground">
                                        Point of Contact (POC) & Access Recovery
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Manage account access, deliverability fallbacks, and personnel handover
                                    </p>
                                </div>
                            </div>

                            {/* POC Handover Modal Button */}
                            <Dialog open={handoverOpen} onOpenChange={setHandoverOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-1.5">
                                        <Users className="h-4 w-4" />
                                        Initiate POC Handover
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-md">
                                    <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2">
                                            <ShieldAlert className="h-5 w-5 text-warning" />
                                            POC Handover Procedure
                                        </DialogTitle>
                                        <DialogDescription>
                                            Transfer institution management to a new Point of Contact.
                                            The previous account will be deactivated (preserving audit history)
                                            and a fresh access link will be generated.
                                        </DialogDescription>
                                    </DialogHeader>

                                    <form onSubmit={handlePocHandoverSubmit} className="space-y-4 py-2">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="requesterEmail">Requester Email *</Label>
                                            <Input
                                                id="requesterEmail"
                                                type="email"
                                                placeholder="registrar@university.edu"
                                                value={handoverForm.requesterEmail}
                                                onChange={(e) =>
                                                    setHandoverForm((f) => ({
                                                        ...f,
                                                        requesterEmail: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                Email of the authority requesting the handover (recorded in audit logs)
                                            </p>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="verificationMethod">
                                                Identity Verification Method *
                                            </Label>
                                            <Input
                                                id="verificationMethod"
                                                placeholder="e.g. Domain matching + official registrar letterhead"
                                                value={handoverForm.verificationMethod}
                                                onChange={(e) =>
                                                    setHandoverForm((f) => ({
                                                        ...f,
                                                        verificationMethod: e.target.value,
                                                    }))
                                                }
                                                required
                                            />
                                            <p className="text-[11px] text-muted-foreground">
                                                Defensible proof of identity check performed before actioning
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="newPocName">New POC Name *</Label>
                                                <Input
                                                    id="newPocName"
                                                    placeholder="Dr. Jane Smith"
                                                    value={handoverForm.newPocName}
                                                    onChange={(e) =>
                                                        setHandoverForm((f) => ({
                                                            ...f,
                                                            newPocName: e.target.value,
                                                        }))
                                                    }
                                                    required
                                                />
                                            </div>

                                            <div className="space-y-1.5">
                                                <Label htmlFor="newPocEmail">New POC Email *</Label>
                                                <Input
                                                    id="newPocEmail"
                                                    type="email"
                                                    placeholder="jane.smith@institution.edu"
                                                    value={handoverForm.newPocEmail}
                                                    onChange={(e) =>
                                                        setHandoverForm((f) => ({
                                                            ...f,
                                                            newPocEmail: e.target.value,
                                                        }))
                                                    }
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="notes">Admin Notes / Ticket Reference</Label>
                                            <Input
                                                id="notes"
                                                placeholder="Support Ticket #1042 / Registrar verified"
                                                value={handoverForm.notes}
                                                onChange={(e) =>
                                                    setHandoverForm((f) => ({
                                                        ...f,
                                                        notes: e.target.value,
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className="rounded-lg bg-warning/10 border border-warning/25 p-3 text-xs text-foreground space-y-1">
                                            <p className="font-semibold text-warning">Security Safeguards:</p>
                                            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                                                <li>Previous POC ({institution.email}) is deactivated, never deleted.</li>
                                                <li>Handover action is permanently recorded in the audit trail.</li>
                                                <li>New single-use recovery link will be immediately available.</li>
                                            </ul>
                                        </div>

                                        <DialogFooter className="gap-2 pt-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setHandoverOpen(false)}
                                                disabled={handoverSubmitting}
                                            >
                                                Cancel
                                            </Button>
                                            <Button type="submit" disabled={handoverSubmitting}>
                                                {handoverSubmitting ? 'Actioning Handover…' : 'Confirm & Hand Over'}
                                            </Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        </div>

                        {/* POC Info & Direct Link Action Buttons */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Current POC State */}
                            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs uppercase font-medium text-muted-foreground">
                                        Current POC Profile
                                    </span>
                                    {poc?.isActive !== false ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success bg-success/10 px-2 py-0.5 rounded-full">
                                            <ShieldCheck className="h-3 w-3" /> Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                                            <UserMinus className="h-3 w-3" /> Deactivated
                                        </span>
                                    )}
                                </div>
                                <p className="font-semibold text-sm text-foreground">
                                    {poc?.fullName || institution.name}
                                </p>
                                <p className="text-xs text-muted-foreground break-all">
                                    {institution.email}
                                </p>
                                {poc?.deactivatedReason && (
                                    <p className="text-xs text-destructive/90 bg-destructive/5 p-2 rounded border border-destructive/20 mt-2">
                                        {poc.deactivatedReason}
                                    </p>
                                )}
                            </div>

                            {/* Direct Access Fallback Links */}
                            <div className="lg:col-span-2 rounded-xl border border-border bg-secondary/10 p-4 space-y-3">
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                                        <KeyRound className="h-4 w-4 text-primary" />
                                        Direct Single-Use Access Link (Deliverability Fallback)
                                    </h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Generate copyable links if university mail servers delay or filter Supabase emails.
                                        Regenerating immediately invalidates previous tokens.
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleGenerateLink('recovery')}
                                        disabled={generatingLink}
                                        className="gap-1.5"
                                    >
                                        <KeyRound className="h-3.5 w-3.5" />
                                        {generatingLink ? 'Generating…' : 'Generate Reset Link'}
                                    </Button>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleGenerateLink('invite')}
                                        disabled={generatingLink}
                                        className="gap-1.5"
                                    >
                                        <UserPlus className="h-3.5 w-3.5" />
                                        {generatingLink ? 'Generating…' : 'Generate Invite Link'}
                                    </Button>
                                </div>

                                {/* Generated Link Display Box */}
                                {generatedLink && (
                                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 mt-3 animate-in fade-in">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-primary capitalize">
                                                {generatedLink.type} Link Generated (Single-Use · Valid {generatedLink.expiresInHours}h)
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">
                                                Previous links invalidated
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Input
                                                readOnly
                                                value={generatedLink.url}
                                                className="font-mono text-xs bg-background h-8"
                                            />
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleCopyLink}
                                                className="shrink-0 h-8 gap-1.5"
                                            >
                                                {copiedLink ? (
                                                    <>
                                                        <Check className="h-3.5 w-3.5 text-success" />
                                                        Copied
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="h-3.5 w-3.5" />
                                                        Copy Link
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Admin Audit Trail Card */}
                    <Card className="overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
                            <div className="flex items-center gap-2">
                                <History className="h-4 w-4 text-muted-foreground" />
                                <h3 className="text-base font-semibold text-foreground">
                                    Administrative & POC Turnover Audit Trail
                                </h3>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {auditLogs.length} recorded events
                            </span>
                        </div>

                        {auditLogs.length === 0 ? (
                            <div className="px-6 py-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No administrative handover or direct link events logged for this institution yet.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="border-b border-border bg-secondary/40">
                                        <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                                            <th className="px-6 py-3 font-semibold">Action</th>
                                            <th className="px-6 py-3 font-semibold">Requester</th>
                                            <th className="px-6 py-3 font-semibold">POC Transition</th>
                                            <th className="px-6 py-3 font-semibold">Details</th>
                                            <th className="px-6 py-3 font-semibold">Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {auditLogs.map((log) => (
                                            <tr key={log.id} className="text-xs">
                                                <td className="px-6 py-3 font-medium capitalize text-foreground">
                                                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px]">
                                                        {log.action.replace(/_/g, ' ')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-muted-foreground">
                                                    {log.requesterEmail || '—'}
                                                </td>
                                                <td className="px-6 py-3 text-foreground">
                                                    {log.previousPocEmail && log.newPocEmail ? (
                                                        <span className="flex items-center gap-1 font-mono text-[11px]">
                                                            <span className="line-through text-muted-foreground">
                                                                {log.previousPocEmail}
                                                            </span>
                                                            {' → '}
                                                            <span className="font-semibold text-primary">
                                                                {log.newPocEmail}
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        log.newPocEmail || '—'
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-muted-foreground">
                                                    {(log.details?.verificationMethod as string) ||
                                                        (log.details?.reason as string) ||
                                                        'Direct link generated'}
                                                </td>
                                                <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">
                                                    {formatDate(log.createdAt)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>

                    {/* Credentials List Card */}
                    <Card className="overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
                            <h3 className="text-base font-semibold text-foreground">
                                Credentials issued
                            </h3>
                            <span className="text-sm text-muted-foreground">
                                {institution.credentialCount} total ·{' '}
                                {institution.activeCredentialCount} active
                            </span>
                        </div>

                        {data.credentials.length === 0 ? (
                            <div className="px-6 py-10 text-center">
                                <p className="text-sm text-muted-foreground">
                                    This institution has not issued any credentials yet.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="border-b border-border bg-secondary/40">
                                        <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                                            <th className="px-6 py-3 font-semibold">Token</th>
                                            <th className="px-6 py-3 font-semibold">Degree</th>
                                            <th className="px-6 py-3 font-semibold">Issued</th>
                                            <th className="px-6 py-3 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {data.credentials.map((credential) => (
                                            <tr key={credential.id}>
                                                <td className="px-6 py-3 font-mono text-xs text-foreground">
                                                    {credential.tokenId}
                                                </td>
                                                <td className="px-6 py-3 text-foreground">
                                                    {credential.degree ?? '—'}
                                                </td>
                                                <td className="px-6 py-3 text-muted-foreground">
                                                    {formatDate(credential.issuedAt)}
                                                </td>
                                                <td className="px-6 py-3">
                                                    {credential.revoked ? (
                                                        <span className="font-semibold text-destructive">
                                                            Revoked
                                                        </span>
                                                    ) : (
                                                        <span className="font-semibold text-success">
                                                            Active
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </div>
            )}
        </ConsoleShell>
    );
}

export default function AdminInstitutionDetailPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <InstitutionDetailContent />
        </ProtectedRoute>
    );
}
