'use client';

import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { TeamManager } from '@/components/institution/TeamManager';
import { ProtectedRoute } from '@/contexts/AuthContext';

/**
 * Team — /dashboard/team (Issue #307).
 *
 * Owners invite, re-role and remove their institution's members here, without
 * an Acredia admin, so the institution never depends on one person.
 */
function TeamContent() {
    return (
        <InstitutionConsolePage
            title="Team"
            subtitle="The people who can act for your institution"
        >
            {() => <TeamManager />}
        </InstitutionConsolePage>
    );
}

export default function TeamPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <TeamContent />
        </ProtectedRoute>
    );
}
