'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Building2, ExternalLink, Search, ShieldCheck, AlertCircle } from 'lucide-react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/stellar';

type Issuer = {
    id: string;
    name: string;
    wallet_address: string | null;
    authorization_tx_hash: string | null;
    verified_at: string;
};

function IssuerCard({ issuer }: { issuer: Issuer }) {
    const shortAddr = issuer.wallet_address
        ? `${issuer.wallet_address.slice(0, 8)}…${issuer.wallet_address.slice(-6)}`
        : null;
    const shortTx = issuer.authorization_tx_hash
        ? `${issuer.authorization_tx_hash.slice(0, 10)}…`
        : null;
    const verifiedDate = new Date(issuer.verified_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });

    return (
        <div className="group rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">{issuer.name}</h3>
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            <ShieldCheck className="h-3 w-3" />
                            Verified
                        </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Verified on {verifiedDate}
                    </p>
                </div>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
                {issuer.wallet_address && (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">Wallet address</dt>
                        <dd>
                            <a
                                href={getExplorerAddressUrl(issuer.wallet_address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                                title={issuer.wallet_address}
                            >
                                {shortAddr}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </dd>
                    </div>
                )}
                {issuer.authorization_tx_hash && (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">On-chain authorization</dt>
                        <dd>
                            <a
                                href={getExplorerTxUrl(issuer.authorization_tx_hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                                title={issuer.authorization_tx_hash}
                            >
                                {shortTx}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </dd>
                    </div>
                )}
                {!issuer.wallet_address && !issuer.authorization_tx_hash && (
                    <p className="text-xs text-muted-foreground italic">
                        On-chain details not yet available for this issuer.
                    </p>
                )}
            </dl>
        </div>
    );
}

export default function IssuersPage() {
    const [issuers, setIssuers] = useState<Issuer[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchIssuers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/issuers');
            const body = await res.json();
            if (body.success) {
                setIssuers(body.issuers);
            } else {
                setError(body.error ?? 'Failed to load issuer registry.');
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchIssuers();
    }, [fetchIssuers]);

    const filtered = issuers.filter((i) =>
        i.name.toLowerCase().includes(query.toLowerCase()) ||
        (i.wallet_address ?? '').toLowerCase().includes(query.toLowerCase()),
    );

    return (
        <div className="flex min-h-screen flex-col">
            <SiteNavbar />

            <main className="flex-1">
                {/* Hero */}
                <section className="border-b border-border bg-secondary/30 py-14 sm:py-20">
                    <div className="container-shell">
                        <div className="mx-auto max-w-2xl text-center">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <ShieldCheck className="h-7 w-7" />
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                                Verified Issuer Registry
                            </h1>
                            <p className="mt-4 text-lg text-muted-foreground">
                                Every institution listed here has been vetted by Acredia and
                                authorised on the Stellar blockchain. Cross-check any issuer's
                                wallet address against their on-chain authorization record.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Search + list */}
                <section className="container-shell py-10">
                    {/* Search bar */}
                    <div className="mx-auto mb-8 max-w-lg">
                        <label htmlFor="issuer-search" className="sr-only">
                            Search verified issuers
                        </label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                                id="issuer-search"
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search by name or wallet address…"
                                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>

                    {/* States */}
                    {loading && (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {[...Array(3)].map((_, i) => (
                                <div
                                    key={i}
                                    className="h-36 animate-pulse rounded-xl border border-border bg-card"
                                />
                            ))}
                        </div>
                    )}

                    {!loading && error && (
                        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
                            <AlertCircle className="h-8 w-8 text-destructive" />
                            <p className="text-sm text-muted-foreground">{error}</p>
                            <button
                                onClick={fetchIssuers}
                                className="text-sm font-medium text-primary underline"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {!loading && !error && filtered.length === 0 && (
                        <p className="py-16 text-center text-muted-foreground">
                            {query ? `No verified issuers matching "${query}".` : 'No verified issuers yet.'}
                        </p>
                    )}

                    {!loading && !error && filtered.length > 0 && (
                        <>
                            <p className="mb-4 text-sm text-muted-foreground">
                                {filtered.length} verified issuer{filtered.length !== 1 ? 's' : ''}
                                {query && ` matching "${query}"`}
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {filtered.map((issuer) => (
                                    <IssuerCard key={issuer.id} issuer={issuer} />
                                ))}
                            </div>
                        </>
                    )}

                    {/* How to verify note */}
                    <div className="mx-auto mt-12 max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                        <p className="font-semibold text-foreground">How to cross-check on-chain</p>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6">
                            <li>Click the wallet address link to open the issuer's account on Stellar Expert.</li>
                            <li>Click the on-chain authorization link to view the exact transaction that granted this institution credential-issuance rights.</li>
                            <li>Compare the wallet address shown here with the <code className="rounded bg-secondary px-1">issuer_wallet_address</code> on any credential's verification page.</li>
                        </ol>
                        <p className="mt-3">
                            To verify a specific credential, visit the{' '}
                            <Link href="/verify" className="text-primary underline">
                                verification page
                            </Link>
                            .
                        </p>
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    );
}
