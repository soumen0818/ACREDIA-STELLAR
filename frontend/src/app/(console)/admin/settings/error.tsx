'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminSettingsError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Admin settings unavailable"
            description="We could not load the system configuration settings. Please try again."
            actionLabel="Try again"
            secondaryActionLabel="Back to Admin Dashboard"
            secondaryActionHref="/admin"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
