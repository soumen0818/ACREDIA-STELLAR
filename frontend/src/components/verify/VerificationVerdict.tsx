'use client';

import { AlertCircle, AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export type VerdictKind =
    | 'verified'
    | 'revoked'
    | 'expired'
    | 'mismatch'
    | 'not-found'
    | 'unavailable';

interface VerdictConfig {
    icon: typeof CheckCircle2;
    /** Container tone. Kept to a flat tint + 1px border — no shadow stack. */
    container: string;
    /** Icon chip tone. */
    chip: string;
    title: string;
    line: string;
}

const VERDICTS: Record<VerdictKind, VerdictConfig> = {
    verified: {
        icon: CheckCircle2,
        container: 'border-success/30 bg-success/8',
        chip: 'bg-success/12 text-success',
        title: 'Credential Verified ✓',
        line: 'This credential is recorded on the Stellar ledger and is currently valid.',
    },
    revoked: {
        icon: ShieldOff,
        container: 'border-warning/30 bg-warning/8',
        chip: 'bg-warning/15 text-warning',
        title: 'Credential Revoked',
        line: 'This credential has been revoked and should no longer be relied on.',
    },
    expired: {
        icon: Clock,
        container: 'border-warning/30 bg-warning/8',
        chip: 'bg-warning/15 text-warning',
        title: 'Credential Expired',
        line: 'This credential has passed its expiry date and is no longer valid.',
    },
    mismatch: {
        icon: AlertTriangle,
        container: 'border-destructive/30 bg-destructive/8',
        chip: 'bg-destructive/12 text-destructive',
        title: 'Details Could Not Be Verified',
        line: 'The details Acredia holds for this credential do not match the record on the Stellar ledger, so they are not shown. Do not rely on any copy of them.',
    },
    'not-found': {
        icon: AlertCircle,
        container: 'border-destructive/30 bg-destructive/8',
        chip: 'bg-destructive/12 text-destructive',
        title: 'Credential Not Found',
        line: 'No credential matches this token ID. Check the ID and try again.',
    },
    unavailable: {
        icon: HelpCircle,
        container: 'border-border bg-card',
        chip: 'bg-secondary text-muted-foreground',
        title: 'Verification Unavailable',
        line: 'This credential could not be checked right now. Please try again shortly.',
    },
};

/**
 * The answer to the only question this page exists to answer, stated once and
 * loudly enough that nothing else competes with it.
 *
 * Deliberately carries a single supporting line: the *why* belongs to the
 * signal rows below, and the identifiers to the collapsed technical tier.
 */
export function VerificationVerdict({
    kind,
    /** Replaces the default supporting line — used to add e.g. a revocation date. */
    line,
}: {
    kind: VerdictKind;
    line?: string;
}) {
    const verdict = VERDICTS[kind];
    const Icon = verdict.icon;

    return (
        <section
            className={cn('rounded-2xl border p-5 sm:p-6', verdict.container)}
            aria-labelledby="verification-verdict"
            role="status"
        >
            <div className="flex items-start gap-4">
                <span
                    className={cn(
                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14',
                        verdict.chip,
                    )}
                >
                    <Icon className="h-7 w-7 sm:h-8 sm:w-8" />
                </span>
                <div className="min-w-0">
                    <h2
                        id="verification-verdict"
                        className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"
                    >
                        {verdict.title}
                    </h2>
                    <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted-foreground">
                        {line ?? verdict.line}
                    </p>
                </div>
            </div>
        </section>
    );
}
