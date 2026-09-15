'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level error boundary. Without one, a failure here escalates to the
 * global boundary and renders a full-page crash screen, making a contained
 * problem look like a total outage. The copy states what is NOT affected,
 * because that is the question a user actually has.
 */
export default function AcceptInviteError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Invitation could not be opened"
            description="We could not load this invitation. The link may have expired or already been used — ask your administrator for a new one."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
