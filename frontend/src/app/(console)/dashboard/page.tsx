'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsolePage } from '@/components/console/ConsoleShell';
import { InstitutionOverview } from '@/components/console/overview/InstitutionOverview';
import { PendingRoleOverview } from '@/components/console/overview/PendingRoleOverview';
import { StudentOverview } from '@/components/console/overview/StudentOverview';
import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

import { ProtectedRoute, useAuth } from '@/contexts/AuthContext';

/**
 * The institution console used to be a single page with a four-tab strip and
 * the tab held in component state. Those tabs are real routes now, so a
 * bookmarked `?tab=` lands on the section it used to open instead of silently
 * falling back to the first tab.
 */
const LEGACY_TAB_ROUTES: Record<string, string> = {
    issue: '/dashboard/issue',
    'bulk-import': '/dashboard/batch-import',
    'batch-import': '/dashboard/batch-import',
    view: '/dashboard/issued',
    issued: '/dashboard/issued',
    analytics: '/dashboard/analytics',
    credentials: '/dashboard/credentials',
    wallet: '/dashboard/wallet',
};

function DashboardOverview() {
    const { user, userRole } = useAuth();
    const router = useRouter();
    // Suppress the overview for the render in which a redirect is queued, so
    // the wrong console never flashes on screen.
    const [redirecting, setRedirecting] = useState(false);

    // Read the query string directly rather than through `useSearchParams`, so
    // this redirect-only concern does not force the page behind a Suspense
    // boundary.
    useEffect(() => {
        const tab = new URLSearchParams(window.location.search).get('tab');
        const target = tab ? LEGACY_TAB_ROUTES[tab] : undefined;
        if (target) {
            setRedirecting(true);
            router.replace(target);
        }
    }, [router]);

    // Admins have their own console at /admin; /dashboard is not a second one.
    useEffect(() => {
        if (userRole === 'admin') {
            setRedirecting(true);
            router.replace('/admin');
        }
    }, [userRole, router]);

    if (redirecting || userRole === 'admin') {
        return (
            <RouteStateScreen
                title="Opening your console"
                description="Taking you to the right section…"
                variant="loading"
            />
        );
    }

    const name = user?.user_metadata?.name || user?.email || 'there';

    return (
        <ConsolePage
            title="Overview"
            subtitle={
                userRole === 'institution' || userRole === 'student' ? (
                    <>
                        Welcome back, {name} — your{' '}
                        <span className="capitalize">{userRole}</span> console.
                    </>
                ) : (
                    <>Welcome back, {name}.</>
                )
            }
        >
            {/* Layout is role-agnostic — the shell above is identical for every
                role. Only which overview *section* renders depends on the role. */}
            {userRole === 'institution' ? (
                <InstitutionOverview />
            ) : userRole === 'student' ? (
                <StudentOverview />
            ) : (
                <PendingRoleOverview resolving={userRole === 'loading'} />
            )}
        </ConsolePage>
    );
}

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardOverview />
        </ProtectedRoute>
    );
}
