'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function DashboardSettingsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Settings unavailable"
            description="We could not load your user settings at this time. Please try again."
            actionLabel="Try again"
            secondaryActionLabel="Back to Dashboard"
            secondaryActionHref="/dashboard"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
