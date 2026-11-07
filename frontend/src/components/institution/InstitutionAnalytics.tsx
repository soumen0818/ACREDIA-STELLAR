'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle, Download, Eye, TrendingUp, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { captureException } from '@/lib/debug';
import { safeGetSession } from '@/lib/supabase';
import { toast } from 'sonner';

const CHART_HEIGHT = 220;

// recharts is ~350 KB; it is fetched only once a chart is shown, not with the
// page (review §4.1). Client-only: recharts measures the DOM. The placeholder
// takes the chart's height so the card does not jump when it arrives.
const MonthlyBarChart = dynamic(() => import('./MonthlyBarChart').then((mod) => mod.MonthlyBarChart), {
    ssr: false,
    loading: () => <Skeleton className="w-full rounded-lg" style={{ height: CHART_HEIGHT }} />,
});

interface AnalyticsData {
    issuedOverTime: { month: string; count: number }[];
    statusBreakdown: { active: number; revoked: number; total: number };
    verificationsOverTime: { month: string; count: number }[];
    topVerifiedCredentials: {
        tokenId: string;
        credentialType: string;
        studentName: string;
        count: number;
    }[];
}

function StatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <div className="mb-1 flex items-center gap-2">
                <span className="text-muted-foreground">{icon}</span>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </p>
            </div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
    );
}

export function InstitutionAnalytics() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    // Start fetching the chart code now, alongside the data, rather than once
    // the data has arrived and the charts first render.
    useEffect(() => {
        void import('./MonthlyBarChart');
    }, []);

    useEffect(() => {
        async function load() {
            try {
                const {
                    data: { session },
                } = await safeGetSession();
                if (!session?.access_token) {
                    setLoading(false);
                    return;
                }
                const res = await fetch('/api/institution/analytics', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    throw new Error(json.error ?? 'Failed to load analytics');
                }
                setData(json);
            } catch (err) {
                captureException(err, { context: 'InstitutionAnalytics.load' });
                setError(err instanceof Error ? err.message : 'Failed to load analytics');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    const handleExport = async () => {
        setExporting(true);
        try {
            const {
                data: { session },
            } = await safeGetSession();
            if (!session?.access_token) {
                toast.error('Not authenticated');
                return;
            }
            const res = await fetch('/api/institution/export', {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (!res.ok) {
                toast.error('Export failed');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'credentials.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 100);
            toast.success('Export downloaded');
        } catch (err) {
            captureException(err, { context: 'InstitutionAnalytics.export' });
            toast.error('Export failed');
        } finally {
            setExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-48 rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <Card className="p-8 text-center">
                <p className="text-destructive">{error}</p>
            </Card>
        );
    }

    if (!data) return null;

    const { statusBreakdown, issuedOverTime, verificationsOverTime, topVerifiedCredentials } = data;
    const totalVerifications = verificationsOverTime.reduce((s, r) => s + r.count, 0);

    return (
        <div className="space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                    label="Total issued"
                    value={statusBreakdown.total}
                    icon={<TrendingUp className="h-4 w-4" />}
                />
                <StatCard
                    label="Active"
                    value={statusBreakdown.active}
                    icon={<CheckCircle className="h-4 w-4 text-success" />}
                />
                <StatCard
                    label="Revoked"
                    value={statusBreakdown.revoked}
                    icon={<XCircle className="h-4 w-4 text-destructive" />}
                />
                <StatCard
                    label="Verifications"
                    value={totalVerifications}
                    icon={<Eye className="h-4 w-4" />}
                />
            </div>

            {/* Issued over time */}
            <Card className="p-6">
                <h3 className="mb-4 text-base font-semibold text-foreground">
                    Credentials issued (last 12 months)
                </h3>
                <MonthlyBarChart data={issuedOverTime} height={CHART_HEIGHT} />
            </Card>

            {/* Verifications over time */}
            <Card className="p-6">
                <h3 className="mb-4 text-base font-semibold text-foreground">
                    Verifications (last 12 months)
                </h3>
                <MonthlyBarChart data={verificationsOverTime} height={CHART_HEIGHT} />
            </Card>

            {/* Top verified credentials + CSV export */}
            <Card className="p-6">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-foreground">
                        Most verified credentials
                    </h3>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                        <Download className="mr-2 h-4 w-4" />
                        {exporting ? 'Exporting...' : 'Export CSV'}
                    </Button>
                </div>
                {topVerifiedCredentials.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        No verifications recorded yet.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {topVerifiedCredentials.map((cred, i) => (
                            <div
                                key={cred.tokenId}
                                className="flex items-center justify-between rounded-lg border border-border p-3"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                        {i + 1}
                                    </span>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            {cred.studentName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {cred.credentialType}
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-semibold text-foreground">
                                    {cred.count} verif.
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
