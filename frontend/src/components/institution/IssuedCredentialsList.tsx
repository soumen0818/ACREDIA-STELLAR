'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
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
import { getIPFSUrl } from '@/lib/ipfs';
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
    ipfs_hash: string;
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
    const { address } = useStellarAccount();

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

            const { data: { session } } = await supabase.auth.getSession();
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
        if (!address) { toast.error('Please connect your wallet first'); return; }
        if (!credentialToRevoke) { toast.error('No credential selected'); return; }

        setIsRevoking(true);
        try {
            await revokeCredentialById(credentialToRevoke.id, address);
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
                errorMessage = 'Network mismatch. Please check your Freighter wallet settings.';
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
            <Card className="p-6 bg-white border-gray-200 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Issued Credentials</h2>
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
            <Card className="p-8 bg-white border-gray-200 shadow-lg">
                <div className="flex flex-col items-center justify-center space-y-4">
                    <AlertCircle className="h-12 w-12 text-red-500" />
                    <p className="text-red-600">{error}</p>
                    <Button onClick={loadCredentials} variant="outline" className="border-teal-600 text-teal-600 hover:bg-teal-50">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Retry
                    </Button>
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-6 bg-white border-gray-200 shadow-lg">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Issued Credentials</h2>
                <Button onClick={loadCredentials} variant="outline" size="sm" className="border-gray-300 text-gray-700 hover:bg-gray-100">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
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
                <select
                    value={status}
                    onChange={e => updateParams({ status: e.target.value })}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="revoked">Revoked</option>
                </select>
                <input
                    type="date"
                    value={dateFrom}
                    onChange={e => updateParams({ dateFrom: e.target.value })}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <input
                    type="date"
                    value={dateTo}
                    onChange={e => updateParams({ dateTo: e.target.value })}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                {(search || status !== 'all' || dateFrom || dateTo) && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.replace(pathname)}
                        className="text-gray-500"
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
                <div className="bg-teal-50 rounded-lg p-4">
                    <p className="text-sm text-teal-700 font-medium">Showing</p>
                    <p className="text-3xl font-bold text-teal-900">{total}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-sm text-green-700 font-medium">Page</p>
                    <p className="text-3xl font-bold text-green-900">{page} of {totalPages || 1}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm text-blue-700 font-medium">Per page</p>
                    <p className="text-3xl font-bold text-blue-900">{PAGE_SIZE}</p>
                </div>
            </div>

            {/* Empty state */}
            {credentials.length === 0 ? (
                <div className="text-center py-12">
                    <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 text-lg">
                        {search || status !== 'all' || dateFrom || dateTo
                            ? 'No credentials match your filters'
                            : 'No credentials issued yet'}
                    </p>
                    {(search || status !== 'all' || dateFrom || dateTo) && (
                        <Button onClick={() => router.replace(pathname)} variant="link" className="mt-2 text-teal-600">
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
                    <span className="text-sm text-gray-600">
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
                            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
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
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <div className="flex items-start space-x-2">
                                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                                    <div className="text-sm text-yellow-800">
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
    const ipfsUrl = credential.ipfs_hash ? getIPFSUrl(credential.ipfs_hash) : null;
    const blockchainUrl = credential.blockchain_hash
        ? `https://stellar.expert/explorer/testnet/tx/${credential.blockchain_hash}`
        : null;

    return (
        <div className="border border-gray-200 rounded-lg p-4 hover:border-teal-500 transition-colors">
            <div className="flex items-start justify-between">
                <div className="flex-1 space-y-3">
                    <div className="flex items-center space-x-3">
                        <Award className="h-5 w-5 text-teal-600" />
                        <h3 className="font-semibold text-gray-900">{metadata.credentialType || 'Credential'}</h3>
                        {credential.revoked ? (
                            <Badge variant="destructive">Revoked</Badge>
                        ) : (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        )}
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <User className="h-4 w-4" />
                        <span className="font-medium">Student:</span>
                        <span>{metadata.studentName || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <FileText className="h-4 w-4" />
                        <span className="font-medium">Degree:</span>
                        <span>{metadata.degree || 'N/A'}</span>
                        {metadata.major && <span className="text-gray-500">({metadata.major})</span>}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600">
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
                    <div className="text-xs text-gray-500 font-mono">Token ID: {credential.token_id || 'Pending...'}</div>
                </div>
                <div className="flex flex-col space-y-2">
                    {ipfsUrl && (
                        <a href={ipfsUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="border-teal-600 text-teal-600 hover:bg-teal-50">
                                <ExternalLink className="h-4 w-4 mr-1" />IPFS
                            </Button>
                        </a>
                    )}
                    {blockchainUrl && (
                        <a href={blockchainUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="border-cyan-600 text-cyan-600 hover:bg-cyan-50">
                                <ExternalLink className="h-4 w-4 mr-1" />Txn
                            </Button>
                        </a>
                    )}
                    {!credential.revoked && (
                        <Button variant="outline" size="sm" className="border-red-600 text-red-600 hover:bg-red-50" onClick={() => onRevoke(credential)}>
                            <XCircle className="h-4 w-4 mr-1" />Revoke
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}