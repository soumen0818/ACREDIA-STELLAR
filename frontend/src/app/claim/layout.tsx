import type { ReactNode } from 'react';
import { StellarProvider } from '@/contexts/StellarContext';

/**
 * The wallet for `/claim`, where a student proves they own a wallet by
 * signing a message. The page needs no session, so only the wallet provider
 * is mounted (review §4.1).
 */
export default function ClaimLayout({ children }: { children: ReactNode }) {
    return <StellarProvider>{children}</StellarProvider>;
}
