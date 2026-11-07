'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
    Activity,
    ArrowRight,
    Building2,
    CheckCircle2,
    RefreshCw,
    Shield,
    ShieldAlert,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConsolePage } from '@/components/console/ConsoleShell';
import { ConnectWalletNotice } from '@/components/admin/ConnectWalletNotice';
import { PendingInstitutionsPanel } from '@/components/admin/PendingInstitutionsPanel';
import { RetentionPanel } from '@/components/admin/RetentionPanel';
import { AdminGate } from '@/components/admin/AdminGate';
import { IndexerHealth, VerificationOutcomes, RateLimiterStatus } from '@/components/admin/AdminOverviewPanels';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { debugLog, captureException } from '@/lib/debug';
import { adminFetch } from '@/lib/adminApi';
import { runtimeConfig } from '@/lib/runtimeConfig';
import { useContractOwner } from '@/hooks/useContractOwner';

interface AdminStats {
    totalInstitutions: number;
    authorizedInstitutions: number;
    totalCredentials: number;
    activeCredentials: number;
    totalStudents: number;
    verificationActivity: {
        totalAttempts: number;
        attemptsLast24h: number;
        // Already returned by /api/admin/stats; the overview used to discard it.
        resultCounts?: Record<string, number>;
    };
    indexer?: {
        lastLedger: number | null;
        lastUpdated: string | null;
    };
    rateLimiterMode?: 'distributed' | 'in-memory-fallback' | 'in-memory-unconfigured';
}

const EMPTY_STATS: AdminStats = {
    totalInstitutions: 0,
    authorizedInstitutions: 0,
    totalCredentials: 0,
    activeCredentials: 0,
    totalStudents: 0,
    verificationActivity: {
        totalAttempts: 0,
        attemptsLast24h: 0,
        resultCounts: {},
    },
    indexer: { lastLedger: null, lastUpdated: null },
    rateLimiterMode: 'in-memory-unconfigured',
};

const REFRESH_INTERVAL_MS = 30_000;

function StatCard({
    icon: Icon,
    iconClassName,
    label,
    value,
    caption,
    loading,
}: {
    icon: typeof Users;
    iconClassName: string;
    label: string;
    value: number;
    caption: string;
    loading: boolean;
}) {
    return (
        <Card className="p-5">
            <div className="flex items-center gap-3">
                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
                >
                    <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
            </div>

            {/* Only the first load shows a skeleton. Background refreshes replace
                the number in place so it never blinks out. */}
            {loading ? (
                <Skeleton className="mt-4 h-9 w-16" />
            ) : (
                <p className="mt-4 text-3xl font-bold tabular-nums text-foreground">{value}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{loading ? ' ' : caption}</p>
        </Card>
    );
}

function AdminDashboardContent() {
    const { address, isOwner, isChecking, contractOwner } = useContractOwner();

    const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
    const [loadingStats, setLoadingStats] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // Bumped by the Refresh button so the attention panel reloads alongside the
    // statistics. The 30s background poll leaves it alone.
    const [refreshToken, setRefreshToken] = useState(0);

    const fetchStats = useCallback(async (silent = false) => {
        try {
            if (silent) {
                setRefreshing(true);
            } else {
                setLoadingStats(true);
            }

            const data = await adminFetch<{ stats: AdminStats }>('/api/admin/stats');
            setStats(data.stats);
            debugLog('Admin statistics loaded.');
        } catch (error) {
            captureException(error, { context: 'fetchStats' });
            // A failed background poll keeps the last good numbers on screen
            // instead of nagging every 30 seconds.
            if (!silent) {
                toast.error(
                    error instanceof Error ? error.message : 'Failed to load statistics',
                );
            }
        } finally {
            setLoadingStats(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        if (!isOwner) return;

        fetchStats();
        const interval = setInterval(() => fetchStats(true), REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [isOwner, fetchStats]);

    const handleRefresh = useCallback(() => {
        fetchStats(true);
        setRefreshToken((value) => value + 1);
    }, [fetchStats]);

    const revokedCredentials = Math.max(stats.totalCredentials - stats.activeCredentials, 0);

    return (
        <ConsolePage
            // No subtitle: the sidebar entry already reads "Overview — System
            // statistics", so a subtitle here would state the same fact a third
            // time in one viewport (ACREDIA-STELLAR#225).
            title="Overview"
            actions={
                isOwner ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={refreshing || loadingStats}
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                ) : undefined
            }
        >
            {/* The three blocking states each own the whole content area, so
                none of them leaves a small card stranded above an empty page. */}
            {!address ? (
                <ConnectWalletNotice message="Connect the contract owner wallet to load system statistics and manage issuer authorizations." />
            ) : isChecking ? (
                <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center lg:min-h-[calc(100vh-12rem)]">
                    <Card className="w-full max-w-xl p-8 text-center">
                        <Skeleton className="mx-auto h-5 w-56" />
                        <Skeleton className="mx-auto mt-4 h-4 w-full max-w-md" />
                    </Card>
                </div>
            ) : !isOwner ? (
                <AdminGate
                    icon={ShieldAlert}
                    title="Read-only mode — not the contract owner"
                    message="Statistics stay hidden and issuer authorization is disabled until you connect the wallet that deployed the contract."
                >
                    <dl className="space-y-3 rounded-xl border border-border bg-card p-4 text-left">
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Connected
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs text-foreground">
                                {address}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Contract owner
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs text-foreground">
                                {contractOwner || 'Could not fetch'}
                            </dd>
                        </div>
                    </dl>
                </AdminGate>
            ) : (
                <div className="space-y-6">
                    {/* The landing screen leads with what needs doing, not with
                        who is signed in. */}
                    <PendingInstitutionsPanel refreshToken={refreshToken} />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard
                            icon={Users}
                            iconClassName="bg-primary/10 text-primary"
                            label="Total institutions"
                            value={stats.totalInstitutions}
                            caption="Registered institutions"
                            loading={loadingStats}
                        />
                        <StatCard
                            icon={CheckCircle2}
                            iconClassName="bg-success/12 text-success"
                            label="Authorized"
                            value={stats.authorizedInstitutions}
                            caption="Authorized to issue"
                            loading={loadingStats}
                        />
                        <StatCard
                            icon={Shield}
                            iconClassName="bg-primary/10 text-primary"
                            label="Total credentials"
                            value={stats.totalCredentials}
                            caption={`${stats.activeCredentials} active, ${revokedCredentials} revoked`}
                            loading={loadingStats}
                        />
                        <StatCard
                            icon={Activity}
                            iconClassName="bg-gold/12 text-gold"
                            label="Verification checks"
                            value={stats.verificationActivity.totalAttempts}
                            caption={`${stats.verificationActivity.attemptsLast24h} in last 24h`}
                            loading={loadingStats}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Link
                            href="/admin/institutions"
                            className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                                <Building2 className="h-5 w-5" />
                            </span>
                            <h3 className="mt-4 font-semibold text-foreground">Institutions</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Browse every registered institution and inspect the credentials it
                                has issued.
                            </p>
                            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                                View institutions
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </span>
                        </Link>

                        <Link
                            href="/admin/authorize"
                            className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/12 text-gold transition-transform group-hover:scale-105">
                                <Shield className="h-5 w-5" />
                            </span>
                            <h3 className="mt-4 font-semibold text-foreground">Authorize issuer</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Grant a wallet permission to issue credentials on-chain.
                            </p>
                            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                                Open authorization
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </span>
                        </Link>
                    </div>

                    {/* Verification outcomes, indexer position, and limiter status ride along in
                        the same /api/admin/stats payload the numbers above come
                        from — no extra request. */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <VerificationOutcomes
                            counts={stats.verificationActivity.resultCounts}
                            loading={loadingStats}
                        />
                        <IndexerHealth indexer={stats.indexer} loading={loadingStats} />
                        <RateLimiterStatus mode={stats.rateLimiterMode} loading={loadingStats} />
                    </div>

                    {/* A stalled purge means the published privacy policy has
                        stopped being true, so it is surfaced here rather than
                        left to silence (ACREDIA-STELLAR#227). */}
                    <RetentionPanel refreshToken={refreshToken} />

                    {/* Deployment metadata: useful, but never the loudest thing
                        on the page. */}
                    <div className="rounded-xl border border-border bg-card px-5 py-4">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Credential contract
                            </span>
                            <span className="break-all font-mono text-xs text-foreground">
                                {runtimeConfig.contracts.CREDENTIAL_NFT}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
}

export default function AdminDashboardPage() {
    return (
            <AdminDashboardContent />
    );
}
