'use client';

import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { StudentRoster } from '@/components/institution/StudentRoster';
import { ProtectedRoute } from '@/contexts/AuthContext';

/** Student roster — /dashboard/students (Issue #241). */
function StudentsContent() {
    return (
        <InstitutionConsolePage
            title="Students"
            subtitle="Add, correct, invite, and deactivate the students on your roster"
        >
            {() => <StudentRoster />}
        </InstitutionConsolePage>
    );
}

export default function StudentsPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <StudentsContent />
        </ProtectedRoute>
    );
}
