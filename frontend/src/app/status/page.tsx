import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { formatUtcDateTime } from '@/lib/credentialStatus';
import { pageMetadata } from '@/lib/pageMetadata';
import { getServiceHealth, HEALTH_CACHE_SECONDS, type HealthReport, type HealthState } from '@/lib/serviceHealth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMetadata({
    title: 'System status',
    description:
        'Whether Acredia credential verification, sign-in and shared credentials are working right now.',
    path: '/status',
    card: 'site',
});

const STATE_LABEL: Record<HealthState, string> = {
    operational: 'Operational',
    degraded: 'Degraded',
    outage: 'Unavailable',
};

const STATE_TONE: Record<HealthState, { icon: typeof CheckCircle2; text: string; panel: string }> = {
    operational: { icon: CheckCircle2, text: 'text-success', panel: 'border-success/30 bg-success/8' },
    degraded: { icon: AlertTriangle, text: 'text-warning', panel: 'border-warning/30 bg-warning/8' },
    outage: { icon: XCircle, text: 'text-destructive', panel: 'border-destructive/30 bg-destructive/8' },
};

const HEADLINE: Record<HealthState, { title: string; line: string }> = {
    operational: {
        title: 'All systems operational',
        line: 'Credentials can be verified, and every part of Acredia is working normally.',
    },
    degraded: {
        title: 'Some services are degraded',
        line: 'Acredia is working, but part of it is slower or limited. Verification results remain reliable.',
    },
    outage: {
        title: 'Acredia is having an outage',
        line: 'Some checks cannot be completed right now. A credential that cannot be checked is not a bad credential: please try again later.',
    },
};

/** The worst of several states. */
function worst(...states: HealthState[]): HealthState {
    if (states.includes('outage')) return 'outage';
    if (states.includes('degraded')) return 'degraded';
    return 'operational';
}

/** What a person can do, rather than which system serves it. */
function services(report: HealthReport) {
    const { blockchain, database, auth, storage, rateLimiting } = report.dependencies;
    return [
        {
            name: 'Verification',
            description: 'Checking a credential against its record on the Stellar ledger.',
            state: blockchain,
        },
        {
            name: 'Sign-in and consoles',
            description: 'Signing in, and the institution, student and admin consoles.',
            state: worst(database, auth),
        },
        {
            name: 'Shared credentials and documents',
            description: 'Credential share links and the documents attached to credentials.',
            state: worst(database, storage),
        },
        {
            name: 'Abuse protection',
            description: 'Request limits that protect the service. When degraded, everything else still works.',
            state: rateLimiting,
        },
    ];
}

export default async function StatusPage() {
    const report = await getServiceHealth();
    const headline = HEADLINE[report.status];
    const tone = STATE_TONE[report.status];
    const HeadlineIcon = tone.icon;

    return (
        <div className="flex min-h-dvh flex-col">
            <SiteNavbar />

            <main className="flex-1">
                <div className="container-shell py-14 sm:py-20">
                    <div className="mx-auto max-w-2xl">
                        <p className="text-sm font-medium text-muted-foreground">Status</p>
                        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                            System status
                        </h1>

                        <section
                            aria-labelledby="status-headline"
                            className={cn('mt-8 rounded-2xl border p-5 sm:p-6', tone.panel)}
                        >
                            <div className="flex items-start gap-4">
                                <HeadlineIcon aria-hidden="true" className={cn('mt-0.5 h-7 w-7 shrink-0', tone.text)} />
                                <div className="min-w-0">
                                    <h2 id="status-headline" className="text-xl font-bold tracking-tight text-foreground">
                                        {headline.title}
                                    </h2>
                                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{headline.line}</p>
                                </div>
                            </div>
                        </section>

                        <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card" aria-label="Services">
                            {services(report).map((service) => {
                                const serviceTone = STATE_TONE[service.state];
                                const Icon = serviceTone.icon;
                                return (
                                    <li key={service.name} className="flex items-start justify-between gap-4 p-5">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-foreground">{service.name}</p>
                                            <p className="mt-1 text-sm text-muted-foreground">{service.description}</p>
                                        </div>
                                        <p className={cn('flex shrink-0 items-center gap-1.5 text-sm font-medium', serviceTone.text)}>
                                            <Icon aria-hidden="true" className="h-4 w-4" />
                                            {/* Read as "Verification: Operational". */}
                                            <span className="sr-only">{service.name}: </span>
                                            {STATE_LABEL[service.state]}
                                        </p>
                                    </li>
                                );
                            })}
                        </ul>

                        <p className="mt-4 text-sm text-muted-foreground">
                            Last checked {formatUtcDateTime(report.checkedAt)}. Checks are repeated at most every{' '}
                            {HEALTH_CACHE_SECONDS} seconds; reload the page for the latest.
                        </p>

                        <div className="mt-10 rounded-xl border border-border bg-card p-6 text-sm leading-6 text-muted-foreground">
                            <p className="font-semibold text-foreground">Could not verify a credential?</p>
                            <p className="mt-2">
                                If verification is unavailable above, the problem is on our side, not with the
                                credential. Try again once it is operational. If everything is operational and a
                                credential still cannot be checked, check its token ID on the{' '}
                                <Link href="/verify" className="text-primary underline">
                                    verification page
                                </Link>{' '}
                                or{' '}
                                <Link href="/contact" className="text-primary underline">
                                    contact us
                                </Link>
                                .
                            </p>
                        </div>
                    </div>
                </div>
            </main>

            <SiteFooter />
        </div>
    );
}
