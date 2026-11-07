'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function DashboardError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Dashboard could not load"
            description="We hit a problem loading your dashboard. Please try again or return home."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
