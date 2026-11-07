'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function DashboardCredentialsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Credentials workspace unavailable"
            description="We could not load your credentials records from the network. Please try refreshing or checking your connection."
            actionLabel="Try again"
            secondaryActionLabel="Back to Dashboard"
            secondaryActionHref="/dashboard"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
