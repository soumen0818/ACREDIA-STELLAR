'use client';

import { StellarProvider } from '@/contexts/StellarContext';
import { AuthProvider } from '@/contexts/AuthContext';

/**
 * Root Providers Component
 *
 * Includes the Auth context for Supabase
 * and Stellar Context for Freighter wallet.
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <StellarProvider>
            <AuthProvider>{children}</AuthProvider>
        </StellarProvider>
    );
}
