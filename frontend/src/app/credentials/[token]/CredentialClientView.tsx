'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { PublicCredentialCard } from '@/components/student/PublicCredentialCard';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { verdictLine } from '@/components/verify/VerificationReport';
import { VerificationVerdict } from '@/components/verify/VerificationVerdict';
import { parseShareResponse, type SharedCredentialView } from '@/lib/sharedCredentialView';

interface CredentialClientViewProps {
    /** The holder's share token from `/credentials/<share_token>`. */
    token: string;
}

type LoadState =
    | { kind: 'loading' }
    | { kind: 'loaded'; view: SharedCredentialView }
    | { kind: 'not-found' }
    | { kind: 'unavailable' };

export function CredentialClientView({ token }: CredentialClientViewProps) {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    useEffect(() => {
        let mounted = true;

        async function load() {
            setState({ kind: 'loading' });
            try {
                const res = await fetch(`/api/credentials/share/${encodeURIComponent(token)}`);
                const payload = await res.json().catch(() => null);
                if (!mounted) return;

                if (res.status === 404) {
                    setState({ kind: 'not-found' });
                    return;
                }
                if (!res.ok || !payload?.success) {
                    setState({ kind: 'unavailable' });
                    return;
                }
                setState({ kind: 'loaded', view: parseShareResponse(token, payload) });
            } catch {
                if (mounted) setState({ kind: 'unavailable' });
            }
        }

        void load();

        return () => {
            mounted = false;
        };
    }, [token]);

    return (
        <div className="min-h-screen bg-secondary/30">
            <SiteNavbar />

            <main className="container mx-auto px-4 py-12">
                <div className="max-w-4xl mx-auto space-y-8">
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold text-foreground">Academic Credential</h1>
                        <p className="text-muted-foreground">
                            Shared by its holder and checked against the Stellar ledger
                        </p>
                    </div>

                    {state.kind === 'loading' && (
                        <Card className="p-8 space-y-6">
                            <Skeleton className="h-8 w-2/3" />
                            <Skeleton className="h-4 w-1/3" />
                            <div className="grid grid-cols-2 gap-4 pt-4">
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        </Card>
                    )}

                    {(state.kind === 'not-found' || state.kind === 'unavailable') && (
                        <div className="space-y-4">
                            <VerificationVerdict
                                kind={state.kind}
                                line={
                                    state.kind === 'not-found'
                                        ? 'This share link does not match any credential. Check that you copied the whole link, or ask the holder to share it again.'
                                        : undefined
                                }
                            />
                            <Button asChild variant="outline">
                                <Link href="/verify">Go to the verification portal</Link>
                            </Button>
                        </div>
                    )}

                    {state.kind === 'loaded' && (
                        <div className="space-y-6">
                            <VerificationVerdict
                                kind={
                                    !state.view.card
                                        ? 'mismatch'
                                        : state.view.status.status === 'valid'
                                          ? 'verified'
                                          : state.view.status.status
                                }
                                line={state.view.card ? verdictLine(state.view.status) : undefined}
                            />

                            {state.view.card ? (
                                <PublicCredentialCard credential={state.view.card} />
                            ) : (
                                <Button asChild variant="outline">
                                    <Link href={`/verify?token=${state.view.status.token_id}`}>
                                        Check this credential&apos;s status on the ledger
                                    </Link>
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
