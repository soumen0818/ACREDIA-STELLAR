import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { IssuerRegistry } from './IssuerRegistry';

export default function IssuersPage() {
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
                    <IssuerRegistry />

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
