'use client';

import { Suspense } from 'react';
import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { IssuedCredentialsList } from '@/components/institution/IssuedCredentialsList';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ProtectedRoute } from '@/contexts/AuthContext';

function ListFallback() {
    return (
        <Card className="space-y-4 p-6">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
        </Card>
    );
}

/** Issued credentials — /dashboard/issued (formerly the "View issued" tab). */
function IssuedCredentialsContent() {
    return (
        <InstitutionConsolePage
            title="Issued credentials"
            subtitle="Browse, verify, and revoke the credentials you have issued"
        >
            {(profile) => (
                // The list reads its filters and page from the query string, so
                // it needs a Suspense boundary of its own.
                <Suspense fallback={<ListFallback />}>
                    <IssuedCredentialsList institutionId={profile.institutionId} />
                </Suspense>
            )}
        </InstitutionConsolePage>
    );
}

export default function IssuedCredentialsPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <IssuedCredentialsContent />
        </ProtectedRoute>
    );
}
