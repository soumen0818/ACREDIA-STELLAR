'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level error boundary. Without one, a failure here escalates to the
 * global boundary and renders a full-page crash screen, making a contained
 * problem look like a total outage. The copy states what is NOT affected,
 * because that is the question a user actually has.
 */
export default function PrivacyError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Page unavailable"
            description="We could not load the Privacy Policy. Please try again in a moment."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
