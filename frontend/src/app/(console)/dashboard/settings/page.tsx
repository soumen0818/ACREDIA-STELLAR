'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ConsolePage } from '@/components/console/ConsoleShell';
import { AccountSettingsPanels } from '@/components/settings/AccountSettingsPanels';
import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

import { ProtectedRoute, useAuth } from '@/contexts/AuthContext';

/**
 * Dashboard Settings page — /dashboard/settings
 *
 * Provides the GDPR Art. 17 "Delete My Account" feature (right to erasure).
 * The deletion flow:
 *   1. User reads the warning about on-chain immutability.
 *   2. User types "DELETE" to confirm intent.
 *   3. Client POSTs /api/account/erase with the current bearer token.
 *   4. On 204, the client signs out and redirects to the home page.
 *
 * Admins have the same panels at /admin/settings, inside their own console.
 */
function SettingsContent() {
    const { userRole } = useAuth();
    const router = useRouter();

    // Links that land here generically (e.g. the notification unsubscribe
    // redirect) must not drop an admin out of the admin console.
    useEffect(() => {
        if (userRole === 'admin') {
            router.replace(`/admin/settings${window.location.search}`);
        }
    }, [userRole, router]);

    if (userRole === 'admin') {
        return (
            <RouteStateScreen
                title="Opening your console"
                description="Taking you to the admin settings…"
                variant="loading"
            />
        );
    }

    return (
        <ConsolePage
            title="Account settings"
            subtitle="Manage your account preferences and data rights."
        >
            <AccountSettingsPanels />
        </ConsolePage>
    );
}

export default function DashboardSettingsPage() {
    return (
        <ProtectedRoute>
            <SettingsContent />
        </ProtectedRoute>
    );
}
