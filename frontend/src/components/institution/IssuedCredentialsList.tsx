'use client';

import { useEffect, useState, useCallback } from 'react';
import { safeGetSession } from '@/lib/supabase';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { revokeCredentialById } from '@/lib/credentialService';
import { CredentialDocumentCheck } from '@/components/student/CredentialDocumentCheck';
import { getCredentialDocumentUrl } from '@/lib/credentialDocumentAccess';
import { formatValidThrough } from '@/lib/credentialStatus';
import { getExplorerTxUrl } from '@/lib/stellar';
import {
    ExternalLink,
    Search,
    FileText,
    Calendar,
    User,
    Award,
    Loader2,
    RefreshCw,
    AlertCircle,
    XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { useStellarAccount } from '@/contexts/StellarContext';
import { toast } from 'sonner';

interface IssuedCredentialsListProps {
    institutionId: string;
    refreshTrigger?: number;
}

interface Credential {
    id: string;
    token_id: string;
    /** SHA-256 of the private document, when one was attached (review §3.11). */
    document_sha256?: string | null;
    expires_at?: string | null;
    blockchain_hash: string;
    metadata: {
        credentialData?: {
            studentName?: string;
            degree?: string;
            major?: string;
            gpa?: string;
            issueDate?: string;
            credentialType?: string;
        };
    } | null;
    issued_at: string;
    revoked: boolean;
}

import { captureException } from '@/lib/debug';

const PAGE_SIZE = 10;

export function IssuedCredentialsList({ refreshTrigger }: IssuedCredentialsListProps) {
    const router     = useRouter();
    const pathname   = usePathname();
    const searchParams = useSearchParams();

    const page     = Math.max(1, parseInt(searchParams.get('page')   ?? '1'));
    const search   = searchParams.get('search')   ?? '';
    const status   = searchParams.get('status')   ?? 'all';
    const dateFrom = searchParams.get('dateFrom') ?? '';
    const dateTo   = searchParams.get('dateTo')   ?? '';

    const [credentials, setCredentials]   = useState<Credential[]>([]);
    const [total, setTotal]               = useState(0);
    const [totalPages, setTotalPages]     = useState(0);
    const [isLoading, setIsLoading]       = useState(true);
    const [error, setError]               = useState<string | null>(null);
    const [revokeDialogOpen, setRevokeDialogOpen]   = useState(false);
    const [credentialToRevoke, setCredentialToRevoke] = useState<Credential | null>(null);
    const [isRevoking, setIsRevoking]     = useState(false);
    const { address, signer } = useStellarAccount();

    const updateParams = useCallback((updates: Record<string, string>) => {
        const params = new URLSearchParams(searchParams.toString());
        Object.entries(updates).forEach(([k, v]) => {
            if (v) params.set(k, v);
            else params.delete(k);
        });
        if (!('page' in updates)) params.set('page', '1');
        router.replace(`${pathname}?${params.toString()}`);
    }, [searchParams, router, pathname]);

    const loadCredentials = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const params = new URLSearchParams({
                page: page.toString(),
                pageSize: PAGE_SIZE.toString(),
                ...(search   && { search }),
                ...(status !== 'all' && { status }),
                ...(dateFrom && { dateFrom }),
                ...(dateTo   && { dateTo }),
            });

            const {
                data: { session },
            } = await safeGetSession();
            const accessToken = session?.access_token;
if (!accessToken) {
    setCredentials([]);
    return;
}

const res = await fetch(`/api/institution/credentials?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
});
            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || 'Failed to load credentials');
            }

            setCredentials(json.credentials ?? []);
            setTotal(json.total ?? 0);
            setTotalPages(json.totalPages ?? 0);
        } catch (err: unknown) {
            captureException(err, { context: 'loadCredentials' });
            setError((err instanceof Error ? err.message : String(err)) || 'Failed to load credentials');
        } finally {
            setIsLoading(false);
        }
    }, [page, search, status, dateFrom, dateTo]);

    useEffect(() => {
        loadCredentials();
    }, [loadCredentials, refreshTrigger]);

    const handleRevokeClick = (credential: Credential) => {
        setCredentialToRevoke(credential);
        setRevokeDialogOpen(true);
    };

    const handleRevokeConfirm = async () => {
        // Revocation needs a signature, so the signer is the real requirement.
        if (!signer) { toast.error('Please connect your wallet first'); return; }
        if (!credentialToRevoke) { toast.error('No credential selected'); return; }

        setIsRevoking(true);
        try {
            await revokeCredentialById(credentialToRevoke.id, signer);
            toast.success('Credential revoked successfully');
            setRevokeDialogOpen(false);
            setCredentialToRevoke(null);
            await loadCredentials(); // Refresh list
        } catch (err: unknown) {
            captureException(err, { context: 'handleRevokeConfirm' });

            // Show user-friendly error messages
            let errorMessage = 'Failed to revoke credential';

            if ((err instanceof Error ? err.message : String(err))?.includes('canceled') || (err instanceof Error ? err.message : String(err))?.includes('rejected')) {
                errorMessage = 'Revocation was canceled or rejected by you';
            } else if ((err instanceof Error ? err.message : String(err))?.includes('Network')) {
                errorMessage = 'Network mismatch. Please check your wallet’s network settings.';
            } else if ((err instanceof Error ? err.message : String(err))?.includes('same wallet')) {
                errorMessage = 'You must connect the same wallet that issued this credential';
            } else if ((err instanceof Error ? err.message : String(err))?.includes('Not authorized')) {
                errorMessage = 'Only the institution that issued this credential can revoke it';
            } else if ((err instanceof Error ? err.message : String(err))?.includes('already revoked')) {
                errorMessage = 'This credential has already been revoked';
            } else if ((err instanceof Error ? err.message : String(err))) {
                errorMessage = (err instanceof Error ? err.message : String(err));
            }
            toast.error(errorMessage, { duration: 5000 });
        } finally {
            setIsRevoking(false);
        }
    };

    // ── Loading skeleton ───────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-foreground">Issued Credentials</h2>
                    <Skeleton className="h-9 w-24" />
                </div>
                
                <div className="mb-6">
                    <Skeleton className="h-10 w-full" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                </div>

                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-40 w-full rounded-xl" />
                    ))}
                </div>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="p-8">
                <div className="flex flex-col items-center justify-center space-y-4">
                    <AlertCircle className="h-12 w-12 text-destructive" />
                    <p className="text-destructive">{error}</p>
                    <Button onClick={loadCredentials} variant="outline">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Retry
                    </Button>
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            {/* The page heading now lives in the console shell, so this card
                only carries its own actions. */}
            <div className="flex items-center justify-end mb-6">
                <Button onClick={loadCredentials} variant="outline" size="sm" className="border-border text-foreground hover:bg-secondary">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        key={search}
                        placeholder="Search by name, degree, token ID..."
                        defaultValue={search}
                        onKeyDown={e => {
                            if (e.key === 'Enter')
                                updateParams({ search: (e.target as HTMLInputElement).value });
                        }}
                        onBlur={e => updateParams({ search: e.target.value })}
                        className="pl-9"
                    />
                </div>
                {/* These controls carry no visible label, so each needs an
                    explicit accessible name (WCAG 2.1 AA, 4.1.2). */}
                <select
                    value={status}
                    onChange={e => updateParams({ status: e.target.value })}
                    aria-label="Filter by status"
                    className="border border-border rounded-md px-3 py-2 text-sm bg-card text-foreground"
                >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="revoked">Revoked</option>
                </select>
                <input
                    type="date"
                    value={dateFrom}
                    onChange={e => updateParams({ dateFrom: e.target.value })}
                    aria-label="Issued on or after"
                    className="border border-border rounded-md px-3 py-2 text-sm"
                />
                <input
                    type="date"
                    value={dateTo}
                    onChange={e => updateParams({ dateTo: e.target.value })}
                    aria-label="Issued on or before"
                    className="border border-border rounded-md px-3 py-2 text-sm"
                />
                {(search || status !== 'all' || dateFrom || dateTo) && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.replace(pathname)}
                        className="text-muted-foreground"
                    >
                        Clear filters
                    </Button>
                )}
            </div>

            {/* Stats */}
            <div
                className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
                role="region"
                aria-label="Credential statistics"
            >
                <div className="rounded-xl border border-border bg-secondary/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Showing</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{total}</p>
                </div>
                <div className="rounded-xl border border-border bg-secondary/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Page</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{page} of {totalPages || 1}</p>
                </div>
                <div className="rounded-xl border border-border bg-secondary/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Per page</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{PAGE_SIZE}</p>
                </div>
            </div>

            {/* Empty state */}
            {credentials.length === 0 ? (
                <div className="text-center py-12">
                    <FileText className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                    <p className="text-muted-foreground text-lg">
                        {search || status !== 'all' || dateFrom || dateTo
                            ? 'No credentials match your filters'
                            : 'No credentials issued yet'}
                    </p>
                    {(search || status !== 'all' || dateFrom || dateTo) && (
                        <Button onClick={() => router.replace(pathname)} variant="link" className="mt-2">
                            Clear filters
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {credentials.map((credential) => (
                        <CredentialCard
                            key={credential.id}
                            credential={credential}
                            onRevoke={handleRevokeClick}
                        />
                    ))}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-6">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => updateParams({ page: String(page - 1) })}
                    >
                        ← Prev
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => updateParams({ page: String(page + 1) })}
                    >
                        Next →
                    </Button>
                </div>
            )}

            {/* Revoke Dialog */}
            <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Revoke Credential</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to revoke this credential? This action cannot be
                            undone. The credential will be marked as revoked on the blockchain and
                            in the database.
                        </DialogDescription>
                    </DialogHeader>
                    {credentialToRevoke && (
                        <div className="py-4 space-y-4">
                            <div className="bg-secondary/40 rounded-lg p-4 space-y-2">
                                <p className="text-sm">
                                    <span className="font-medium">Student:</span>{' '}
                                    {credentialToRevoke.metadata?.credentialData?.studentName ||
                                        'Unknown'}
                                </p>
                                <p className="text-sm">
                                    <span className="font-medium">Credential:</span>{' '}
                                    {credentialToRevoke.metadata?.credentialData?.credentialType ||
                                        'N/A'}
                                </p>
                                <p className="text-sm">
                                    <span className="font-medium">Token ID:</span>{' '}
                                    {credentialToRevoke.token_id}
                                </p>
                            </div>
                            <div className="border border-warning/25 bg-warning/8 rounded-lg p-3">
                                <div className="flex items-start space-x-2">
                                    <AlertCircle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
                                    <div className="text-sm text-foreground">
                                        <p className="font-medium mb-1">Important:</p>
                                        <p>
                                            You must use the same wallet that issued this
                                            credential.
                                        </p>
                                        {address && (
                                            <p className="mt-1 font-mono text-xs break-all">Connected: {address}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRevokeDialogOpen(false)} disabled={isRevoking}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleRevokeConfirm} disabled={isRevoking}>
                            {isRevoking ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Revoking...</>
                            ) : (
                                <><XCircle className="mr-2 h-4 w-4" />Revoke Credential</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function CredentialCard({
    credential,
    onRevoke,
}: {
    credential: Credential;
    onRevoke: (credential: Credential) => void;
}) {
    const metadata = credential.metadata?.credentialData || {};
    const expired =
        !credential.revoked && !!credential.expires_at && Date.now() >= Date.parse(credential.expires_at);
    const blockchainUrl = credential.blockchain_hash
        ? getExplorerTxUrl(credential.blockchain_hash)
        : null;

    return (
        <div className="border border-border rounded-xl p-5 transition-all hover:border-primary/30 hover:shadow-sm">
            <div className="flex items-start justify-between">
                <div className="flex-1 space-y-3">
                    <div className="flex items-center space-x-3">
                        <Award className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-foreground">{metadata.credentialType || 'Credential'}</h3>
                        {credential.revoked ? (
                            <Badge variant="destructive">Revoked</Badge>
                        ) : expired ? (
                            <Badge className="border-warning/25 bg-warning/10 text-warning">Expired</Badge>
                        ) : (
                            <Badge className="border-success/25 bg-success/10 text-success">Active</Badge>
                        )}
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <User className="h-4 w-4" />
                        <span className="font-medium">Student:</span>
                        <span>{metadata.studentName || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span className="font-medium">Degree:</span>
                        <span>{metadata.degree || 'N/A'}</span>
                        {metadata.major && <span className="text-muted-foreground">({metadata.major})</span>}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        {metadata.gpa && <div><span className="font-medium">GPA:</span> {metadata.gpa}</div>}
                        <div className="flex items-center space-x-1">
                            <Calendar className="h-4 w-4" />
                            <span>
                                {metadata.issueDate
                                    ? format(new Date(metadata.issueDate), 'MMM d, yyyy')
                                    : 'Unknown date'}
                            </span>
                        </div>
                    </div>
                    {credential.expires_at && (
                        <div className="text-sm text-muted-foreground">
                            Valid through {formatValidThrough(credential.expires_at)} (UTC)
                        </div>
                    )}
                    <div className="text-xs text-muted-foreground font-mono">Token ID: {credential.token_id || 'Pending...'}</div>
                    {credential.document_sha256 && (
                        <CredentialDocumentCheck
                            loadUrl={() => getCredentialDocumentUrl(credential.id)}
                            sha256={credential.document_sha256}
                            tokenId={credential.token_id}
                            anchored={false}
                        />
                    )}
                </div>
                <div className="flex flex-col space-y-2">
                    {blockchainUrl && (
                        <a href={blockchainUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm">
                                <ExternalLink className="h-4 w-4 mr-1" />Txn
                            </Button>
                        </a>
                    )}
                    {!credential.revoked && (
                        <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/8" onClick={() => onRevoke(credential)}>
                            <XCircle className="h-4 w-4 mr-1" />Revoke
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}