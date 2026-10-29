'use client';

import { Suspense } from 'react';
import { ConsolePage } from '@/components/console/ConsoleShell';
import StudentCredentialsList from '@/components/student/StudentCredentialsList';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { ProtectedRoute, useAuth } from '@/contexts/AuthContext';

function ListFallback() {
    return (
        <Card className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
        </Card>
    );
}

/** Credentials issued to the signed-in student — /dashboard/credentials. */
function StudentCredentialsContent() {
    const { user } = useAuth();

    return (
        <ConsolePage
            title="My credentials"
            subtitle="Every credential issued to you"
        >
            {/* The list is loaded by the signed-in account, so no wallet is
                needed to view it (review §3.3). */}
            <Suspense fallback={<ListFallback />}>
                <StudentCredentialsList studentId={user?.id || ''} />
            </Suspense>
        </ConsolePage>
    );
}

export default function StudentCredentialsPage() {
    return (
        <ProtectedRoute allowedRoles={['student']}>
            <StudentCredentialsContent />
        </ProtectedRoute>
    );
}
