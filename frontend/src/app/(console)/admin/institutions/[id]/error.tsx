'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminInstitutionDetailError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Institution details unavailable"
            description="We could not load the requested institution profile. Please verify your permissions and try again."
            actionLabel="Try again"
            secondaryActionLabel="All Institutions"
            secondaryActionHref="/admin/institutions"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
