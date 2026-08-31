'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Check,
    Copy,
    Download,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Upload,
    UserMinus,
    UserPlus,
    Users,
} from 'lucide-react';
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
import { captureException } from '@/lib/debug';
import { safeGetSession } from '@/lib/supabase';
import {
    downloadStudentCsvTemplate,
    parseStudentCsv,
    validateStudentRows,
    type CsvStudentRow,
} from '@/lib/studentRosterImport';

interface Student {
    id: string;
    name: string;
    email: string;
    studentRef: string | null;
    walletAddress: string | null;
    status: string;
    hasAccount: boolean;
    invitedAt: string | null;
    inviteAcceptedAt: string | null;
    claimedAt: string | null;
    deactivatedAt: string | null;
    createdAt: string | null;
}

/** Calls an institution API route with the caller's session attached. */
async function institutionFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const {
        data: { session },
    } = await safeGetSession();

    if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again.');
    }

    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    if (options?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Request failed');
    }

    return payload as T;
}

function StatusBadge({ student }: { student: Student }) {
    const { label, className } =
        student.status === 'deactivated'
            ? { label: 'Deactivated', className: 'bg-destructive/12 text-destructive border-destructive/25' }
            : student.status === 'active'
              ? { label: 'Active', className: 'bg-success/12 text-success border-success/25' }
              : { label: 'Invited', className: 'bg-info/12 text-info border-info/25' };

    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}
        >
            {label}
        </span>
    );
}

const EMPTY_FORM = { name: '', email: '', studentRef: '', walletAddress: '' };

export function StudentRoster() {
    const [students, setStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');

    const [addOpen, setAddOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');

    const [importOpen, setImportOpen] = useState(false);
    const [importRows, setImportRows] = useState<CsvStudentRow[]>([]);
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [rowErrors, setRowErrors] = useState<Array<{ row: CsvStudentRow; errors: string[] }>>([]);
    const [importing, setImporting] = useState(false);
    const [importReport, setImportReport] = useState<{
        created: number;
        rejected: Array<{ email: string; error: string }>;
    } | null>(null);

    const [editing, setEditing] = useState<Student | null>(null);
    const [editForm, setEditForm] = useState({ name: '', studentRef: '', walletAddress: '' });

    const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(
        async (silent = false) => {
            try {
                if (silent) setRefreshing(true);
                else setLoading(true);

                const params = new URLSearchParams();
                if (query.trim()) params.set('search', query.trim());

                const data = await institutionFetch<{ students: Student[] }>(
                    `/api/institution/students?${params.toString()}`,
                );
                setStudents(data.students);
                setError('');
            } catch (err) {
                captureException(err, { context: 'studentRosterLoad' });
                const message = err instanceof Error ? err.message : 'Failed to load students';
                setError(message);
                if (!silent) toast.error(message);
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [query],
    );

    useEffect(() => {
        // Debounced so typing in the search box does not fire a request per key.
        const timer = setTimeout(() => load(), 300);
        return () => clearTimeout(timer);
    }, [load]);

    const validRowCount = useMemo(
        () => rowErrors.filter((entry) => entry.errors.length === 0).length,
        [rowErrors],
    );

    const handleAdd = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError('');
        setSubmitting(true);

        try {
            await institutionFetch('/api/institution/students', {
                method: 'POST',
                body: JSON.stringify({
                    students: [
                        {
                            name: form.name.trim(),
                            email: form.email.trim(),
                            studentRef: form.studentRef.trim() || undefined,
                            walletAddress: form.walletAddress.trim() || undefined,
                        },
                    ],
                }),
            });

            toast.success('Student added');
            setForm(EMPTY_FORM);
            setAddOpen(false);
            load(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to add student';
            setFormError(message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleFile = async (file: File) => {
        const text = await file.text();
        const { rows, parseErrors } = parseStudentCsv(text);

        setImportErrors(parseErrors);
        setImportRows(rows);
        setRowErrors(validateStudentRows(rows));
        setImportReport(null);
    };

    const handleImport = async () => {
        const valid = rowErrors.filter((entry) => entry.errors.length === 0).map((entry) => entry.row);

        if (valid.length === 0) {
            toast.error('No valid rows to import.');
            return;
        }

        setImporting(true);

        try {
            const data = await institutionFetch<{
                summary: { created: number };
                rejected: Array<{ email: string; error: string }>;
            }>('/api/institution/students', {
                method: 'POST',
                body: JSON.stringify({
                    students: valid.map((row) => ({
                        name: row.name,
                        email: row.email,
                        studentRef: row.studentRef,
                        walletAddress: row.walletAddress,
                    })),
                }),
            });

            setImportReport({ created: data.summary.created, rejected: data.rejected });
            toast.success(`Imported ${data.summary.created} student(s)`);
            load(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Import failed';
            toast.error(message);
        } finally {
            setImporting(false);
        }
    };

    const handleSaveEdit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!editing) return;

        setSubmitting(true);

        try {
            await institutionFetch(`/api/institution/students/${editing.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    name: editForm.name.trim(),
                    studentRef: editForm.studentRef.trim() || null,
                    walletAddress: editForm.walletAddress.trim() || null,
                }),
            });

            toast.success('Student updated');
            setEditing(null);
            load(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update student');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleStatus = async (student: Student) => {
        const deactivating = student.status !== 'deactivated';

        try {
            await institutionFetch(`/api/institution/students/${student.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: deactivating ? 'deactivated' : 'active' }),
            });

            toast.success(
                deactivating
                    ? 'Student deactivated. Their issued credentials are unaffected.'
                    : 'Student reactivated',
            );
            load(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update student');
        }
    };

    const handleInvite = async (student: Student) => {
        try {
            const data = await institutionFetch<{ inviteLink: string; email: string }>(
                `/api/institution/students/${student.id}/invite`,
                { method: 'POST' },
            );

            setInvite({ email: data.email, link: data.inviteLink });
            setCopied(false);
            load(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to generate invite');
        }
    };

    const copyInvite = async () => {
        if (!invite) return;
        try {
            await navigator.clipboard.writeText(invite.link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Could not copy. Select the link and copy manually.');
        }
    };

    return (
        <div className="space-y-6">
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search by name, email, student ID, or wallet"
                        className="pl-9"
                        aria-label="Search students"
                    />
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => load(true)}
                        disabled={refreshing || loading}
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                        <Upload className="h-4 w-4" />
                        Import CSV
                    </Button>
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Add student
                    </Button>
                </div>
            </Card>

            {loading ? (
                <Card className="space-y-3 p-6">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-64" />
                    <Skeleton className="h-32 w-full" />
                </Card>
            ) : error ? (
                <Card className="border-destructive/25 bg-destructive/8 p-6">
                    <p className="text-sm font-semibold text-destructive">{error}</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => load()}>
                        Try again
                    </Button>
                </Card>
            ) : students.length === 0 ? (
                <Card className="p-10 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                        <Users className="h-6 w-6" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">
                        {query ? 'No students match your search' : 'No students yet'}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {query
                            ? 'Try a different name, email, student ID, or wallet address.'
                            : 'Add students one at a time, or import a whole cohort from CSV.'}
                    </p>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-border bg-secondary/40">
                                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                                    <th className="px-5 py-3 font-semibold">Student</th>
                                    <th className="px-5 py-3 font-semibold">Student ID</th>
                                    <th className="px-5 py-3 font-semibold">Wallet</th>
                                    <th className="px-5 py-3 font-semibold">Status</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {students.map((student) => (
                                    <tr key={student.id} className="transition-colors hover:bg-secondary/40">
                                        <td className="px-5 py-4">
                                            <p className="font-semibold text-foreground">{student.name}</p>
                                            <p className="text-xs text-muted-foreground">{student.email}</p>
                                        </td>
                                        <td className="px-5 py-4 text-muted-foreground">
                                            {student.studentRef || '—'}
                                        </td>
                                        <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                                            {student.walletAddress
                                                ? `${student.walletAddress.slice(0, 6)}…${student.walletAddress.slice(-4)}`
                                                : '—'}
                                        </td>
                                        <td className="px-5 py-4">
                                            <StatusBadge student={student} />
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex justify-end gap-1.5">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setEditing(student);
                                                        setEditForm({
                                                            name: student.name,
                                                            studentRef: student.studentRef ?? '',
                                                            walletAddress: student.walletAddress ?? '',
                                                        });
                                                    }}
                                                    aria-label={`Edit ${student.name}`}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                {student.status !== 'deactivated' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleInvite(student)}
                                                        aria-label={`Invite ${student.name}`}
                                                    >
                                                        <UserPlus className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleToggleStatus(student)}
                                                    aria-label={
                                                        student.status === 'deactivated'
                                                            ? `Reactivate ${student.name}`
                                                            : `Deactivate ${student.name}`
                                                    }
                                                >
                                                    <UserMinus className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Add student */}
            <Dialog
                open={addOpen}
                onOpenChange={(open) => {
                    setAddOpen(open);
                    if (!open) {
                        setForm(EMPTY_FORM);
                        setFormError('');
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add student</DialogTitle>
                        <DialogDescription>
                            Creates a roster record. The wallet is optional — you can issue a
                            credential to a wallet before the student has an account.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleAdd} className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="student-name">Full name</Label>
                            <Input
                                id="student-name"
                                value={form.name}
                                onChange={(event) => setForm({ ...form, name: event.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="student-email">Email</Label>
                            <Input
                                id="student-email"
                                type="email"
                                value={form.email}
                                onChange={(event) => setForm({ ...form, email: event.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="student-ref">Student ID (optional)</Label>
                            <Input
                                id="student-ref"
                                value={form.studentRef}
                                onChange={(event) =>
                                    setForm({ ...form, studentRef: event.target.value })
                                }
                                placeholder="ENR-2026-0142"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="student-wallet">Wallet address (optional)</Label>
                            <Input
                                id="student-wallet"
                                value={form.walletAddress}
                                onChange={(event) =>
                                    setForm({ ...form, walletAddress: event.target.value })
                                }
                                placeholder="G…"
                                className="font-mono text-xs"
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
                            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Adding…' : 'Add student'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* CSV import */}
            <Dialog
                open={importOpen}
                onOpenChange={(open) => {
                    setImportOpen(open);
                    if (!open) {
                        setImportRows([]);
                        setImportErrors([]);
                        setRowErrors([]);
                        setImportReport(null);
                    }
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Import students from CSV</DialogTitle>
                        <DialogDescription>
                            Every row is validated before anything is saved. Rows with problems are
                            listed below and skipped; the rest still import.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => downloadStudentCsvTemplate()}
                            >
                                <Download className="h-4 w-4" />
                                Download template
                            </Button>
                            <Input
                                type="file"
                                accept=".csv,text/csv"
                                className="max-w-xs"
                                aria-label="Choose a CSV file"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) handleFile(file);
                                }}
                            />
                        </div>

                        {importErrors.length > 0 && (
                            <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-4">
                                <p className="text-sm font-semibold text-destructive">
                                    This file could not be read
                                </p>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive/90">
                                    {importErrors.map((message) => (
                                        <li key={message}>{message}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {importRows.length > 0 && (
                            <div className="rounded-lg border border-border p-4">
                                <p className="text-sm text-foreground">
                                    <span className="font-semibold">{validRowCount}</span> of{' '}
                                    <span className="font-semibold">{importRows.length}</span> rows
                                    are ready to import.
                                </p>

                                {rowErrors.some((entry) => entry.errors.length > 0) && (
                                    <div className="mt-3 max-h-56 overflow-y-auto rounded border border-destructive/20 bg-destructive/5 p-3">
                                        <ul className="space-y-2 text-xs text-destructive/90">
                                            {rowErrors
                                                .filter((entry) => entry.errors.length > 0)
                                                .map((entry) => (
                                                    <li key={entry.row.rowNumber}>
                                                        <span className="font-semibold">
                                                            Row {entry.row.rowNumber}
                                                            {entry.row.email ? ` (${entry.row.email})` : ''}:
                                                        </span>{' '}
                                                        {entry.errors.join(' ')}
                                                    </li>
                                                ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {importReport && (
                            <div className="rounded-lg border border-success/25 bg-success/8 p-4 text-sm">
                                <p className="font-semibold text-success">
                                    Imported {importReport.created} student(s).
                                </p>
                                {importReport.rejected.length > 0 && (
                                    <>
                                        <p className="mt-2 text-muted-foreground">
                                            {importReport.rejected.length} row(s) were rejected by the
                                            server:
                                        </p>
                                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                                            {importReport.rejected.map((entry) => (
                                                <li key={entry.email}>
                                                    {entry.email}: {entry.error}
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
                            Close
                        </Button>
                        <Button
                            type="button"
                            onClick={handleImport}
                            disabled={importing || validRowCount === 0}
                        >
                            {importing ? 'Importing…' : `Import ${validRowCount} student(s)`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit student */}
            <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit student</DialogTitle>
                        <DialogDescription>
                            {editing?.email} — the email address identifies this student&apos;s
                            account and cannot be changed here.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSaveEdit} className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="edit-name">Full name</Label>
                            <Input
                                id="edit-name"
                                value={editForm.name}
                                onChange={(event) =>
                                    setEditForm({ ...editForm, name: event.target.value })
                                }
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-ref">Student ID</Label>
                            <Input
                                id="edit-ref"
                                value={editForm.studentRef}
                                onChange={(event) =>
                                    setEditForm({ ...editForm, studentRef: event.target.value })
                                }
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-wallet">Wallet address</Label>
                            <Input
                                id="edit-wallet"
                                value={editForm.walletAddress}
                                onChange={(event) =>
                                    setEditForm({ ...editForm, walletAddress: event.target.value })
                                }
                                placeholder="G…"
                                className="font-mono text-xs"
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : 'Save changes'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Invite link */}
            <Dialog open={Boolean(invite)} onOpenChange={(open) => !open && setInvite(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Invite link</DialogTitle>
                        <DialogDescription>
                            Send this single-use link to {invite?.email}. They set their own
                            password — you never see it. Generating a new link invalidates this one.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex items-center gap-2 py-2">
                        <Input
                            readOnly
                            value={invite?.link ?? ''}
                            className="h-9 bg-background font-mono text-xs"
                            aria-label="Invite link"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={copyInvite}
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

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setInvite(null)}>
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
