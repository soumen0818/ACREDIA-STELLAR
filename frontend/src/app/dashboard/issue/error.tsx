'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level error boundary. Without one, a failure here escalates to the
 * global boundary and renders a full-page crash screen, making a contained
 * problem look like a total outage. The copy states what is NOT affected,
 * because that is the question a user actually has.
 */
export default function IssueError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Issuance unavailable"
            description="We could not load the issuance form. No credential was issued."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
