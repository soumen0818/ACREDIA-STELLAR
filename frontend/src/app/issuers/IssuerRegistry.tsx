'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, ExternalLink, Search, ShieldCheck, AlertCircle } from 'lucide-react';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/stellar';

/**
 * The searchable list on /issuers: the page's only interactive part, so the
 * only part that ships as client JS (review §4.3). The page around it is a
 * Server Component.
 */

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

export function IssuerRegistry() {
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
        <>
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
        </>
    );
}
