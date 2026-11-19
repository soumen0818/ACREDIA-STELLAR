'use client';

import type { ReactNode } from 'react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';

/**
 * The one layout every `/verify` state shares.
 *
 * The page used to branch into eight full-page returns, each with its own
 * container, spacing, and `<h1>`. Screen readers heard a different page title
 * per state and the layout drifted between them, so the frame is fixed here and
 * only the status block below it changes (ACREDIA-STELLAR#226).
 */
export function VerificationPageShell({
    /** One short line under the heading — the state's context, not its verdict. */
    lede,
    children,
}: {
    lede?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="min-h-dvh bg-secondary/30 print:bg-white">
            <div className="print:hidden">
                <SiteNavbar />
            </div>

            <main className="container-shell py-6 sm:py-8 print:py-0">
                <div className="mx-auto w-full max-w-3xl">
                    <header className="mb-5">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                            Credential Verification
                        </h1>
                        {lede && <p className="mt-1 text-sm text-muted-foreground">{lede}</p>}
                    </header>

                    {children}
                </div>
            </main>
        </div>
    );
}
