'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Admin panel unavailable"
            description="We could not load the admin workspace right now. Please try again in a moment."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
