'use client';

import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { InstitutionAnalytics } from '@/components/institution/InstitutionAnalytics';
import { ProtectedRoute } from '@/contexts/AuthContext';

/** Issuance and verification analytics — /dashboard/analytics (formerly the "Analytics" tab). */
function AnalyticsContent() {
    return (
        <InstitutionConsolePage
            title="Analytics"
            subtitle="Issuance volume and verification activity"
        >
            {() => <InstitutionAnalytics />}
        </InstitutionConsolePage>
    );
}

export default function AnalyticsPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <AnalyticsContent />
        </ProtectedRoute>
    );
}
