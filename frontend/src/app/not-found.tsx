import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function NotFound() {
    return (
        <RouteStateScreen
            title="Page not found"
            description="The page you are looking for does not exist or may have moved. Please return home and continue exploring Acredia."
            secondaryActionLabel="Back to home"
            variant="not-found"
        />
    );
}
