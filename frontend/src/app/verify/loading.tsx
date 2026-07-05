import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function VerifyLoading() {
    return (
        <RouteStateScreen
            title="Loading verification"
            description="Preparing the credential verification experience..."
            variant="loading"
        />
    );
}
