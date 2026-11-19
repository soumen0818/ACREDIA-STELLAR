import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StellarProvider } from '@/contexts/StellarContext';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'Claim your credentials',
    description:
        'Credentials issued to your Stellar wallet? Prove you own the wallet and create your Acredia account to view and share them.',
    path: '/claim',
    card: 'site',
});

/**
 * The wallet for `/claim`, where a student proves they own a wallet by
 * signing a message. The page needs no session, so only the wallet provider
 * is mounted (review §4.1).
 */
export default function ClaimLayout({ children }: { children: ReactNode }) {
    return <StellarProvider>{children}</StellarProvider>;
}
