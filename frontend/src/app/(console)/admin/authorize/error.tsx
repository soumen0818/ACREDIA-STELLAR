'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminAuthorizeError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteStateScreen
            title="Authorization workspace unavailable"
            description="We could not initialize the issuer authorization interface. Please ensure your admin session is active and try again."
            actionLabel="Try again"
            secondaryActionLabel="Back to Admin Dashboard"
            secondaryActionHref="/admin"
            onAction={reset}
            error={error}
            variant="error"
        />
    );
}
