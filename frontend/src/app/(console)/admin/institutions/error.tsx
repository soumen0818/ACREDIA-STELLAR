'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminInstitutionsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Institutions directory unavailable"
            description="We were unable to load the list of institutions. Please try refreshing or check your connection."
            actionLabel="Try again"
            secondaryActionLabel="Back to Admin Dashboard"
            secondaryActionHref="/admin"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
