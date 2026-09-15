'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level error boundary. Without one, a failure here escalates to the
 * global boundary and renders a full-page crash screen, making a contained
 * problem look like a total outage. The copy states what is NOT affected,
 * because that is the question a user actually has.
 */
export default function ClaimError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Credential claim unavailable"
            description="We could not load the claim page. Your credential is unaffected — it remains verifiable on-chain."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
