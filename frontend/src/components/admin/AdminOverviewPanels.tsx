'use client';

import { formatDistanceToNow } from 'date-fns';
import { Activity, Database, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Human labels for the verification outcomes recorded in `verification_logs`. */
const RESULT_LABELS: Record<string, string> = {
    verified: 'Verified',
    revoked: 'Revoked',
    expired: 'Expired',
    not_found: 'Not found',
    mismatch: 'Hash mismatch',
    chain_unavailable: 'Chain unavailable',
    invalid_request: 'Invalid request',
    server_error: 'Server error',
};

// Ordered so the two expected outcomes lead and the failure modes follow.
const RESULT_ORDER = [
    'verified',
    'revoked',
    'expired',
    'not_found',
    'mismatch',
    'chain_unavailable',
    'invalid_request',
    'server_error',
];

/**
 * Breakdown of how public verification attempts resolved.
 *
 * The counts already ride along in `/api/admin/stats`; the overview used to
 * fetch and discard them (ACREDIA-STELLAR#225).
 */
export function VerificationOutcomes({
    counts,
    loading,
}: {
    counts: Record<string, number> | undefined;
    loading: boolean;
}) {
    const entries = RESULT_ORDER.filter((key) => key in (counts ?? {})).map(
        (key) => [key, counts?.[key] ?? 0] as const,
    );

    return (
        <Card className="p-5">
            <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/12 text-gold">
                    <Activity className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold text-muted-foreground">
                    Verification outcomes
                </h2>
            </div>

            {loading ? (
                <Skeleton className="mt-5 h-24 w-full" />
            ) : entries.length === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">No verification attempts yet.</p>
            ) : (
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {entries.map(([key, value]) => (
                        <div key={key} className="min-w-0">
                            <dt className="truncate text-xs text-muted-foreground">
                                {RESULT_LABELS[key] ?? key}
                            </dt>
                            <dd className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                                {value}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </Card>
    );
}

function formatSyncedAt(lastUpdated: string | null): string {
    if (!lastUpdated) return 'Not yet synced';
    const date = new Date(lastUpdated);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return `Synced ${formatDistanceToNow(date, { addSuffix: true })}`;
}

/**
 * Ledger position of the background indexer.
 *
 * Reported as-is with no staleness threshold — deciding what counts as "behind"
 * is a product call this screen is not the place to make.
 */
export function IndexerHealth({
    indexer,
    loading,
}: {
    indexer: { lastLedger: number | null; lastUpdated: string | null } | undefined;
    loading: boolean;
}) {
    return (
        <Card className="p-5">
            <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Database className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold text-muted-foreground">Indexer</h2>
            </div>

            {loading ? (
                <Skeleton className="mt-5 h-12 w-40" />
            ) : (
                <>
                    <p className="mt-5 text-2xl font-bold tabular-nums text-foreground">
                        {indexer?.lastLedger != null
                            ? `Ledger ${indexer.lastLedger.toLocaleString()}`
                            : 'No ledger recorded'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {formatSyncedAt(indexer?.lastUpdated ?? null)}
                    </p>
                </>
            )}
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Issue #229 — Rate limiter status panel
// ---------------------------------------------------------------------------

type RateLimiterMode = 'distributed' | 'in-memory-fallback' | 'in-memory-unconfigured';

const LIMITER_LABELS: Record<RateLimiterMode, string> = {
    distributed: 'Distributed (Upstash)',
    'in-memory-fallback': 'In-memory (Redis unreachable)',
    'in-memory-unconfigured': 'In-memory (not configured)',
};

const LIMITER_DESCRIPTIONS: Record<RateLimiterMode, string> = {
    distributed:
        'Rate limits are shared across all serverless instances via Upstash Redis.',
    'in-memory-fallback':
        'Upstash is configured but currently unreachable. Limits are per-instance for now.',
    'in-memory-unconfigured':
        'UPSTASH_REDIS_REST_URL / TOKEN are not set. Limits are per-instance and reset on cold start — set the Upstash variables to enable global rate limiting.',
};

const LIMITER_BADGE_CLASS: Record<RateLimiterMode, string> = {
    distributed: 'bg-success/12 text-success',
    'in-memory-fallback': 'bg-gold/12 text-gold',
    'in-memory-unconfigured': 'bg-destructive/10 text-destructive',
};

/**
 * Displays the active rate-limiting backend so admins can immediately see
 * whether distributed limiting is engaged or whether the deployment is running
 * with per-instance in-memory limits (Issue #229).
 */
export function RateLimiterStatus({
    mode,
    loading,
}: {
    mode: RateLimiterMode | undefined;
    loading: boolean;
}) {
    const safeMode: RateLimiterMode = mode ?? 'in-memory-unconfigured';

    return (
        <Card className="p-5">
            <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Zap className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold text-muted-foreground">Rate limiter</h2>
            </div>

            {loading ? (
                <Skeleton className="mt-5 h-12 w-40" />
            ) : (
                <>
                    <span
                        className={`mt-5 inline-block rounded-full px-3 py-1 text-xs font-semibold ${LIMITER_BADGE_CLASS[safeMode]}`}
                    >
                        {LIMITER_LABELS[safeMode]}
                    </span>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {LIMITER_DESCRIPTIONS[safeMode]}
                    </p>
                </>
            )}
        </Card>
    );
}
