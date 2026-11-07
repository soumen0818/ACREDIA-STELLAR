import type { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { StellarProvider } from '@/contexts/StellarContext';

/**
 * Session and wallet for the consoles: every `/dashboard/*` and `/admin/*`
 * route.
 *
 * These providers used to wrap the root layout, which put the wallet stack
 * and the Supabase client on every page, marketing and legal pages included
 * (review §4.1). The route group adds nothing to the URL. One layout for both
 * consoles keeps the session and the wallet mounted when `/dashboard` sends
 * an admin on to `/admin`.
 */
export default function ConsoleGroupLayout({ children }: { children: ReactNode }) {
    return (
        <StellarProvider>
            <AuthProvider>{children}</AuthProvider>
        </StellarProvider>
    );
}
