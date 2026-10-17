'use client';

import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console/ConsoleShell';
import { ContinuityBanner } from '@/components/institution/ContinuityBanner';
import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';
import { getConsoleNav } from '@/lib/consoleNav';
import { ProtectedRoute, useAuth } from '@/contexts/AuthContext';

function DashboardChrome({ children }: { children: ReactNode }) {
    const { userRole } = useAuth();

    // The sidebar differs per role, so wait for the role to resolve rather than
    // rendering the fallback nav and swapping it a moment later.
    if (!userRole || userRole === 'loading') {
        return (
            <RouteStateScreen
                title="Opening your console"
                description="Taking you to the right section…"
                variant="loading"
            />
        );
    }

    return (
        <ConsoleShell nav={getConsoleNav(userRole)}>
            {/* On every institution page, until a second person can issue (Issue #307). */}
            {userRole === 'institution' && <ContinuityBanner />}
            {children}
        </ConsoleShell>
    );
}

/**
 * Persistent chrome for every `/dashboard/*` route.
 *
 * A layout is not re-rendered when navigating between routes that share it, so
 * hoisting the auth gate and console shell here keeps the sidebar mounted
 * across navigation. Previously each page rendered its own `ConsoleShell`
 * (directly, or via `InstitutionConsolePage`), so every sidebar click unmounted
 * and rebuilt the whole shell — the sidebar briefly vanished and returned as a
 * new DOM node, which looked like a full page reload.
 *
 * `ProtectedRoute` is intentionally not given `allowedRoles` here: the
 * dashboard is shared by institutions and students, and the individual routes
 * keep their own role checks.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <ProtectedRoute>
            <DashboardChrome>{children}</DashboardChrome>
        </ProtectedRoute>
    );
}
