'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { format } from 'date-fns';
import {
    AlertCircle,
    Award,
    Building2,
    Calendar,
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
import { getIPFSUrl } from '@/lib/ipfs';
import { debugLog, captureException } from '@/lib/debug';
import { supabase } from '@/lib/supabase';

interface Credential {
    id: string;
    token_id: string;
    ipfs_hash: string;
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
    issued_at: string;
    revoked: boolean;
    institution?: { name: string } | null;
}

interface StudentCredentialsListProps {
    studentId: string;
    studentWallet?: string;
}

const PAGE_SIZE = 20;

export default function StudentCredentialsList({
    studentId,
    studentWallet,
}: StudentCredentialsListProps) {
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

            if (studentWallet) {
                await supabase
                    .from('students')
                    .update({ wallet_address: studentWallet })
                    .eq('auth_user_id', studentId);
            }

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
    }, [studentId, studentWallet, page, search, status, dateFrom, dateTo]);

    useEffect(() => {
        loadCredentials();
    }, [loadCredentials]);

    // ── Loading skeleton ───────────────────────────────────────────────────────
    if (loading) {
        return (
            <Card className="border-gray-200 bg-white p-6 shadow-lg">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">My Credentials</h2>
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
            <Card className="border-gray-200 bg-white p-8 shadow-lg">
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
        <Card className="border-gray-200 bg-white p-6 shadow-lg">
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">My Credentials</h2>
                <Button onClick={loadCredentials} variant="outline" size="sm" className="border-gray-300 text-gray-700 hover:bg-gray-100">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    <Button variant="outline" size="sm" onClick={() => router.replace(pathname)} className="text-gray-500">
                        Clear filters
                    </Button>
                )}
            </div>

            <div
                className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3"
                role="region"
                aria-label="Credential statistics"
            >
                <div className="rounded-lg bg-teal-50 p-4">
                    <p className="text-sm font-medium text-teal-700">Total</p>
                    <p className="text-3xl font-bold text-teal-900">{total}</p>
                </div>
                <div className="rounded-lg bg-green-50 p-4">
                    <p className="text-sm font-medium text-green-700">Page</p>
                    <p className="text-3xl font-bold text-green-900">{page} of {totalPages || 1}</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-4">
                    <p className="text-sm font-medium text-blue-700">Per page</p>
                    <p className="text-3xl font-bold text-blue-900">{PAGE_SIZE}</p>
                </div>
            </div>

            {/* Empty state */}
            {credentials.length === 0 ? (
                <div className="py-12 text-center">
                    <Award className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <p className="text-lg text-gray-500">
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
        </Card>
    );
}

function CredentialCard({ credential }: { credential: Credential }) {
    const metadata = credential.metadata?.credentialData || {};
    const ipfsUrl = credential.ipfs_hash ? getIPFSUrl(credential.ipfs_hash) : null;
    const blockchainUrl = credential.blockchain_hash
        ? `https://stellar.expert/explorer/testnet/tx/${credential.blockchain_hash}`
        : null;

    const [showQRModal, setShowQRModal] = useState(false);

    const handleShare = () => {
        const shareUrl = `${window.location.origin}/verify?token=${credential.token_id}`;
        navigator.clipboard.writeText(shareUrl);
        alert('Share link copied to clipboard!');
    };

    return (
        <>
            <QRCodeModal open={showQRModal} onClose={() => setShowQRModal(false)} credential={credential} />
            <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-teal-500">
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
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            {metadata.degree && (
                                <div className="flex items-center space-x-2">
                                    <GraduationCap className="h-4 w-4 text-gray-500" />
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
                            )}
                            {metadata.major && <div><span className="font-medium">Major:</span> {metadata.major}</div>}
                            {metadata.gpa   && <div><span className="font-medium">GPA:</span> {metadata.gpa}</div>}
                            {metadata.institutionName && (
                                <div className="flex items-center space-x-2">
                                    <Building2 className="h-4 w-4 text-gray-500" />
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
                        <div className="font-mono text-xs text-gray-500">Token ID: {credential.token_id || 'Pending...'}</div>
                    </div>
                    <div className="ml-4 flex flex-col space-y-2">
                        <Button onClick={() => setShowQRModal(true)} variant="outline" size="sm" className="border-teal-600 text-teal-600 hover:bg-teal-50">
                            <QrCode className="mr-1 h-4 w-4" />QR Code
                        </Button>
                        <Button onClick={handleShare} variant="outline" size="sm" className="border-blue-600 text-blue-600 hover:bg-blue-50">
                            <Share2 className="mr-1 h-4 w-4" />Share
                        </Button>
                        {ipfsUrl && (
                            <a href={ipfsUrl} target="_blank" rel="noopener noreferrer">
                                <Button variant="outline" size="sm" className="w-full border-purple-600 text-purple-600 hover:bg-purple-50">
                                    <ExternalLink className="mr-1 h-4 w-4" />IPFS
                                </Button>
                            </a>
                        )}
                        {blockchainUrl && (
                            <a href={blockchainUrl} target="_blank" rel="noopener noreferrer">
                                <Button variant="outline" size="sm" className="w-full border-cyan-600 text-cyan-600 hover:bg-cyan-50">
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