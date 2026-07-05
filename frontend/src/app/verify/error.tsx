'use client';

import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function VerifyError({ reset }: { reset: () => void }) {
    return (
        <RouteStateScreen
            title="Verification unavailable"
            description="We could not load the verification experience. Please try again or return home."
            actionLabel="Try again"
            secondaryActionLabel="Back to home"
            onAction={reset}
            variant="error"
        />
    );
}
