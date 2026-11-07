'use client';

import { ConsolePage } from '@/components/console/ConsoleShell';
import { InfoField, WalletPromptCard, WalletStatus } from '@/components/console/ConsoleCards';
import { ConnectWallet } from '@/components/ui/ConnectWallet';
import { Card } from '@/components/ui/card';

import { activeNetwork } from '@/lib/stellar';
import { useStellarAccount } from '@/contexts/StellarContext';
import { ProtectedRoute } from '@/contexts/AuthContext';

/** Wallet section of the student console — /dashboard/wallet. */
function StudentWalletContent() {
    const { address } = useStellarAccount();

    return (
        <ConsolePage
            title="Wallet"
            subtitle="The Stellar wallet your credentials are issued to"
        >
            <div className="space-y-6">
                {!address && (
                    <WalletPromptCard message="Credentials are minted to a Stellar address. Connect the wallet you gave your institution to see them here." />
                )}

                <Card className="p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-foreground">
                                Connected wallet
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Connecting is read-only — Acredia never holds your keys.
                            </p>
                        </div>
                        <div className="shrink-0">
                            <ConnectWallet />
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-6 border-t border-border pt-5 md:grid-cols-3">
                        <InfoField label="Status">
                            <WalletStatus address={address} />
                        </InfoField>
                        <InfoField label="Network">
                            <span className="capitalize">{activeNetwork.kind}</span>
                        </InfoField>
                        <div className="min-w-0 md:col-span-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Address
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-foreground">
                                {address || (
                                    <span className="font-sans text-warning">
                                        Not connected — use “Connect Wallet” above.
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                </Card>
            </div>
        </ConsolePage>
    );
}

export default function StudentWalletPage() {
    return (
        <ProtectedRoute allowedRoles={['student']}>
            <StudentWalletContent />
        </ProtectedRoute>
    );
}
