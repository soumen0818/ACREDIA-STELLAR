'use client';

import { ShieldAlert } from 'lucide-react';
import { ConsolePage } from '@/components/console/ConsoleShell';
import { ConnectWalletNotice } from '@/components/admin/ConnectWalletNotice';
import { AuthorizeIssuer } from '@/components/institution/AuthorizeIssuer';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useContractOwner } from '@/hooks/useContractOwner';

function AuthorizeContent() {
    const { address, isOwner, isChecking, contractOwner } = useContractOwner();

    return (
        <ConsolePage
            title="Authorize issuer"
            subtitle="Grant a wallet permission to issue credentials on-chain"
        >
            {!address ? (
                <ConnectWalletNotice message="Authorizing an issuer is an on-chain action signed by the contract owner wallet. Connect that wallet to continue." />
            ) : isChecking ? (
                <Card className="p-6">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="mt-4 h-4 w-full max-w-md" />
                </Card>
            ) : !isOwner ? (
                <Card className="border-warning/25 bg-warning/8 p-6">
                    <div className="flex items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-warning" />
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold text-foreground">
                                This wallet cannot authorize issuers
                            </h3>
                            <p className="mt-1.5 text-sm text-muted-foreground">
                                Only the contract owner can grant issuing rights. Connect the wallet
                                that deployed the contract and try again.
                            </p>
                            <p className="mt-3 text-xs text-muted-foreground">
                                Connected:{' '}
                                <span className="break-all font-mono text-foreground">
                                    {address}
                                </span>
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Contract owner:{' '}
                                <span className="break-all font-mono text-foreground">
                                    {contractOwner || 'Could not fetch'}
                                </span>
                            </p>
                        </div>
                    </div>
                </Card>
            ) : (
                <AuthorizeIssuer />
            )}
        </ConsolePage>
    );
}

export default function AdminAuthorizePage() {
    return (
            <AuthorizeContent />
    );
}
