import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function Loading() {
    return (
        <RouteStateScreen
            title="Loading Acredia"
            description="Preparing the next experience for you. This should only take a moment."
            variant="loading"
        />
    );
}
