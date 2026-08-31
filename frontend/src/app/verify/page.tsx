'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { VerificationPageShell } from '@/components/verify/VerificationPageShell';
import { VerificationReport } from '@/components/verify/VerificationReport';
import { VerificationVerdict } from '@/components/verify/VerificationVerdict';
import { VerifyEntry } from '@/components/verify/VerifyEntry';
import { Button } from '@/components/ui/button';
import { useCredentialVerification } from '@/hooks/useCredentialVerification';
import Link from 'next/link';

/**
 * A failed lookup is either "no such credential" or "we could not check right
 * now". Verifiers act differently on each, so they are not collapsed into one
 * "verification failed" screen.
 */
function isNotFound(error: string | null): boolean {
    if (!error) return true;
    return /not found|invalid/i.test(error);
}

function VerifyContent() {
    const searchParams = useSearchParams();
    const tokenId = searchParams.get('token');
    const {
        loading,
        credential,
        error,
        integrityStatus,
        verificationDetail,
        manualToken,
        setManualToken,
        scanMode,
        scanState,
        scanMessage,
        handleManualVerify,
        startScanner,
        setScanMode,
    } = useCredentialVerification(tokenId);

    // Pinned once per mount so the printed record shows when the check ran,
    // not when the page happened to re-render.
    const checkedAt = useMemo(
        () => new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),
        [],
    );

    if (!tokenId && !loading && !credential) {
        return (
            <VerificationPageShell lede="Confirm that an academic credential is authentic and still valid.">
                <VerifyEntry
                    manualToken={manualToken}
                    setManualToken={setManualToken}
                    onVerify={handleManualVerify}
                    scanMode={scanMode}
                    setScanMode={setScanMode}
                    scanState={scanState}
                    scanMessage={scanMessage}
                    startScanner={startScanner}
                />
            </VerificationPageShell>
        );
    }

    if (loading) {
        return (
            <VerificationPageShell lede="Checking this credential against the Stellar ledger…">
                <div className="space-y-4">
                    <Card className="p-5 sm:p-6">
                        <div className="flex items-start gap-4">
                            <Skeleton className="h-12 w-12 shrink-0 rounded-2xl sm:h-14 sm:w-14" />
                            <div className="min-w-0 flex-1 space-y-2">
                                <Skeleton className="h-7 w-56 max-w-full" />
                                <Skeleton className="h-4 w-full max-w-md" />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-5 sm:p-6">
                        <Skeleton className="h-4 w-28" />
                        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                            {[0, 1, 2, 3].map((index) => (
                                <div key={index} className="space-y-2">
                                    <Skeleton className="h-3 w-24" />
                                    <Skeleton className="h-5 w-40 max-w-full" />
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </VerificationPageShell>
        );
    }

    if (error || !credential) {
        return (
            <VerificationPageShell lede={`Token ID ${tokenId ?? '—'}`}>
                <div className="space-y-4">
                    <VerificationVerdict
                        kind={isNotFound(error) ? 'not-found' : 'unavailable'}
                        line={error ?? undefined}
                    />
                    <div className="flex flex-wrap gap-3">
                        <Button asChild>
                            <Link href="/verify">Try another token ID</Link>
                        </Button>
                        <Button variant="ghost" asChild>
                            <Link href="/">Return home</Link>
                        </Button>
                    </div>
                </div>
            </VerificationPageShell>
        );
    }

    return (
        <VerificationPageShell lede={`Token ID #${credential.token_id}`}>
            <VerificationReport
                credential={credential}
                integrityStatus={integrityStatus}
                detail={verificationDetail}
                checkedAt={checkedAt}
            />

            {/*
              A credential can be issued to a wallet before its student has an
              account (Issue #241), which would otherwise leave them holding a
              valid credential with no way in. Offering the claim here is the
              entry point for exactly that student (Issue #243).
            */}
            <Card className="mt-4 p-5 sm:p-6">
                <h2 className="text-base font-semibold text-foreground">
                    Is this your credential?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    If it was issued to your wallet and you do not have an Acredia account yet,
                    you can claim one by proving you control that wallet.
                </p>
                <Button className="mt-4" asChild>
                    <Link href="/claim">Claim your credentials</Link>
                </Button>
            </Card>
        </VerificationPageShell>
    );
}

export default function VerifyPage() {
    return (
        <Suspense
            fallback={
                <RouteStateScreen
                    title="Loading verification"
                    description="Preparing the credential verification experience..."
                    variant="loading"
                />
            }
        >
            <VerifyContent />
        </Suspense>
    );
}
