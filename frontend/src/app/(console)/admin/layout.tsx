'use client';

import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console/ConsoleShell';
import { CONSOLE_NAV } from '@/lib/consoleNav';
import { ProtectedRoute } from '@/contexts/AuthContext';

/**
 * Persistent chrome for every `/admin/*` route.
 *
 * In the App Router a `layout.tsx` is *not* re-rendered when navigating between
 * routes that share it. Hoisting the auth gate and the console shell here means
 * the sidebar keeps its identity across navigation instead of being unmounted
 * and rebuilt by each page.
 *
 * Before this, every admin page rendered its own `ProtectedRoute` +
 * `ConsoleShell`. Clicking a sidebar link tore the whole shell down and
 * remounted it — measurably: the sidebar element disappeared from the DOM
 * mid-transition and returned as a different node. Navigation was genuinely
 * client-side, but it *looked* like a full page reload.
 *
 * Pages now render only their own content and header (`ConsolePage`).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <ConsoleShell nav={CONSOLE_NAV.admin}>{children}</ConsoleShell>
        </ProtectedRoute>
    );
}
