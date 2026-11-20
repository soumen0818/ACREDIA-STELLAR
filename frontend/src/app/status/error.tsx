'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function StatusError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Status unavailable"
            description="We could not load the system status. Please try again shortly."
            actionLabel="Try again"
            secondaryActionLabel="Back to Home"
            secondaryActionHref="/"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
