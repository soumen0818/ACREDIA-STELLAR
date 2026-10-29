'use client';

import { ShieldCheck, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { InfoField, WalletStatus } from '@/components/console/ConsoleCards';
import { ConsoleQuickLink } from '@/components/console/overview/ConsoleQuickLink';
import { useStellarAccount } from '@/contexts/StellarContext';
import { useAuth } from '@/contexts/AuthContext';

/** Landing section of the student console — account state and shortcuts. */
export function StudentOverview() {
    const { user } = useAuth();
    const { address } = useStellarAccount();

    return (
        <div className="space-y-6">
            <Card className="p-6">
                <h2 className="mb-5 text-base font-semibold text-foreground">
                    Account information
                </h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    <InfoField label="Email">{user?.email}</InfoField>
                    <InfoField label="Name">{user?.user_metadata?.name || 'Not set'}</InfoField>
                    <InfoField label="Wallet status">
                        <WalletStatus address={address} />
                    </InfoField>
                </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ConsoleQuickLink
                    href="/dashboard/credentials"
                    icon={ShieldCheck}
                    title="My credentials"
                    description="Every credential issued to you, with sharing and verification links."
                    cta="View my credentials"
                />
                <ConsoleQuickLink
                    href="/dashboard/wallet"
                    icon={Wallet}
                    iconClassName="bg-gold/12 text-gold"
                    title="Wallet"
                    description="Connect the Stellar wallet your credentials are issued to. To change that wallet, ask your institution."
                    cta="Manage wallet"
                />
            </div>
        </div>
    );
}
