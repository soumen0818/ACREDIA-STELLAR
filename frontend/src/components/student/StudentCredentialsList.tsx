'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { format } from 'date-fns';
import {
    AlertCircle,
    Award,
    Building2,
    Calendar,
    Download,
    ExternalLink,
    GraduationCap,
    QrCode,
    RefreshCw,
    Search,
    Share2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import QRCodeModal from './QRCodeModal';
import { CredentialDocumentCheck } from './CredentialDocumentCheck';
import { getCredentialDocumentUrl } from '@/lib/credentialDocumentAccess';
import { formatValidThrough } from '@/lib/credentialStatus';
import { shareUrl } from '@/lib/sharedCredential';
import { getExplorerTxUrl } from '@/lib/stellar';
import { buildStandardsExportDocument, downloadJsonFile } from '@/lib/standardsExport';
import { debugLog, captureException } from '@/lib/debug';
import { supabase } from '@/lib/supabase';

interface Credential {
    id: string;
    token_id: string;
    /** The holder's share link token (review §3.11b). */
    share_token: string | null;
    /** SHA-256 of the private document, when one was attached. */
    document_sha256: string | null;
    expires_at: string | null;
    blockchain_hash: string;
    metadata: {
        name: string;
        description: string;
        credentialData: {
            studentName: string;
            studentWallet: string;
            degree: string;
            major?: string;
            gpa?: string;
            issueDate: string;
            institutionName: string;
            credentialType: string;
        };
    };
    metadata_schema_version?: number | null;
    hash_algorithm?: string | null;
    issued_at: string;
    revoked: boolean;
    institution?: { name: string } | null;
}

interface StudentCredentialsListProps {
    studentId: string;
}

const PAGE_SIZE = 20;

export default function StudentCredentialsList({ studentId }: StudentCredentialsListProps) {
    const router       = useRouter();
    const pathname     = usePathname();
    const searchParams = useSearchParams();

    const page     = Math.max(1, parseInt(searchParams.get('page')   ?? '1'));
    const search   = searchParams.get('search')   ?? '';
    const status   = searchParams.get('status')   ?? 'all';
    const dateFrom = searchParams.get('dateFrom') ?? '';
    const dateTo   = searchParams.get('dateTo')   ?? '';

    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [total, setTotal]             = useState(0);
    const [totalPages, setTotalPages]   = useState(0);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);

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
        setLoading(true);
        setError(null);

        try {
            if (!studentId) {
                setCredentials([]);
                return;
            }

            // The student's wallet is recorded by their institution (roster) or
            // by the signed /claim flow, never from here: connecting a wallet in
            // the browser proves nothing about owning it (review §3.3).
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw new Error('Failed to refresh your session');

            const accessToken = session?.access_token;
            if (!accessToken) {
                setCredentials([]);
                return;
            }

            // Securely provision/link the student profile first
            const provisionRes = await fetch('/api/student/provision', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!provisionRes.ok) {
                const provisionData = await provisionRes.json().catch(() => ({}));
                const errMessage = provisionData?.error || 'Failed to initialize student profile';
                setError(errMessage);
                setLoading(false);
                return;
            }

            const params = new URLSearchParams({
                page: page.toString(),
                pageSize: PAGE_SIZE.toString(),
                ...(search   && { search }),
                ...(status !== 'all' && { status }),
                ...(dateFrom && { dateFrom }),
                ...(dateTo   && { dateTo }),
            });

            let response = await fetch(`/api/student/credentials?${params}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            let payload = await response.json();

            if (response.status === 401 && payload?.error === 'Invalid or expired access token') {
                const { data: refreshed, error: refreshError } =
                    await supabase.auth.refreshSession();
                const newAccessToken = refreshed.session?.access_token;

                if (refreshError || !newAccessToken) {
                    throw new Error('Your session expired. Please sign in again.');
                }

                response = await fetch(`/api/student/credentials?${params}`, {
                    headers: { Authorization: `Bearer ${newAccessToken}` },
                });
                payload = await response.json();
            }

            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Failed to load credentials');
            }

            debugLog(`Fetched ${payload.credentials?.length} credentials for student dashboard.`);
            setCredentials(payload.credentials ?? []);
            setTotal(payload.total ?? 0);
            setTotalPages(payload.totalPages ?? 0);
        } catch (err: unknown) {
            captureException(err, { context: 'loadCredentials_student' });
            setError((err instanceof Error ? err.message : String(err)) || 'Failed to load credentials');
        } finally {
            setLoading(false);
        }
    }, [studentId, page, search, status, dateFrom, dateTo]);

    useEffect(() => {
        loadCredentials();
    }, [loadCredentials]);

    // ── Loading skeleton ───────────────────────────────────────────────────────
    if (loading) {
        return (
            <Card className="p-6">
                {/* The page heading now lives in the console shell, so this
                    card only carries its own actions. */}
                <div className="mb-6 flex items-center justify-end">
                    <Skeleton className="h-9 w-24" />
                </div>
                
                <div className="mb-6">
                    <Skeleton className="h-10 w-full" />
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
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
            <div className="mb-6 flex items-center justify-end">
                <Button onClick={loadCredentials} variant="outline" size="sm" className="border-border text-foreground hover:bg-secondary">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        key={search}
                        placeholder="Search by type, degree, institution..."
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
                    <Button variant="outline" size="sm" onClick={() => router.replace(pathname)} className="text-muted-foreground">
                        Clear filters
                    </Button>
                )}
            </div>

            <div
                className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3"
                role="region"
                aria-label="Credential statistics"
            >
                <div className="rounded-xl border border-border bg-secondary/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total</p>
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
                <div className="py-12 text-center">
                    <Award className="mx-auto mb-4 h-16 w-16 text-muted-foreground/40" />
                    <p className="text-lg text-muted-foreground">
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
                        <CredentialCard key={credential.id} credential={credential} />
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
        </Card>
    );
}

function CredentialCard({ credential }: { credential: Credential }) {
    const metadata = credential.metadata?.credentialData || {};
    const expired =
        !credential.revoked && credential.expires_at !== null && Date.now() >= Date.parse(credential.expires_at);
    // The share link shows the details and document; without one, only the
    // status check by token ID is available.
    const showcasePath = credential.share_token
        ? `/credentials/${credential.share_token}`
        : `/verify?token=${credential.token_id}`;
    const blockchainUrl = credential.blockchain_hash
        ? getExplorerTxUrl(credential.blockchain_hash)
        : null;

    const [showQRModal, setShowQRModal] = useState(false);
    const [downloading, setDownloading] = useState(false);

    const handleShare = () => {
        const link = credential.share_token
            ? shareUrl(window.location.origin, credential.share_token)
            : `${window.location.origin}/verify?token=${credential.token_id}`;
        navigator.clipboard.writeText(link);
        alert('Share link copied to clipboard!');
    };

    const handleDownloadVc = async () => {
        setDownloading(true);
        try {
            const document = await buildStandardsExportDocument({
                tokenId: credential.token_id,
                shareToken: credential.share_token,
                metadata: credential.metadata,
                metadataSchemaVersion: credential.metadata_schema_version,
                hashAlgorithm: credential.hash_algorithm,
                blockchainHash: credential.blockchain_hash,
            });
            downloadJsonFile(document, `credential-${credential.token_id}-verifiable-credential.json`);
        } catch (err) {
            captureException(err, { context: 'StudentCredentialsList_downloadVc' });
            alert('Failed to build the Verifiable Credential export. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <>
            <QRCodeModal open={showQRModal} onClose={() => setShowQRModal(false)} credential={credential} />
            <div className="rounded-xl border border-border p-5 transition-all hover:border-primary/30 hover:shadow-sm">
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
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            {metadata.degree && (
                                <div className="flex items-center space-x-2">
                                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                                    <span>
                                        <span className="font-medium">Degree:</span>{' '}
                                        {metadata.degree}
                                    </span>
                                </div>
                            )}
                            {metadata.major && (
                                <div>
                                    <span className="font-medium">Major:</span> {metadata.major}
                                </div>
                            )}
                            {metadata.gpa && (
                                <div>
                                    <span className="font-medium">GPA:</span> {metadata.gpa}
                                </div>
                            )}                            {metadata.institutionName && (
                                <div className="flex items-center space-x-2">
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                    <span>{metadata.institutionName}</span>
                                </div>
                            )}
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
                        <div className="font-mono text-xs text-muted-foreground">Token ID: {credential.token_id || 'Pending...'}</div>
                        {credential.document_sha256 && (
                            <CredentialDocumentCheck
                                loadUrl={() => getCredentialDocumentUrl(credential.id)}
                                sha256={credential.document_sha256}
                                tokenId={credential.token_id}
                                anchored={false}
                            />
                        )}
                    </div>
                    <div className="ml-4 flex flex-col space-y-2">
                        <Button onClick={() => setShowQRModal(true)} variant="outline" size="sm">
                            <QrCode className="mr-1 h-4 w-4" />QR Code
                        </Button>
                        <Button asChild variant="default" size="sm">
                            <Link href={showcasePath}>
                                <Share2 className="mr-1 h-4 w-4" />Public Showcase
                            </Link>
                        </Button>
                        <Button onClick={handleShare} variant="outline" size="sm">
                            <Share2 className="mr-1 h-4 w-4" />Copy Link
                        </Button>
                        <Button onClick={handleDownloadVc} variant="outline" size="sm" disabled={downloading}>
                            <Download className="mr-1 h-4 w-4" />
                            {downloading ? 'Preparing...' : 'Download VC (.json)'}
                        </Button>
                        {blockchainUrl && (
                            <a href={blockchainUrl} target="_blank" rel="noopener noreferrer">
                                <Button variant="outline" size="sm" className="w-full">
                                    <ExternalLink className="mr-1 h-4 w-4" />Blockchain
                                </Button>
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}