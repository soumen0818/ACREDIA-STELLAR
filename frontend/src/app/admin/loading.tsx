import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function AdminLoading() {
    return (
        <RouteStateScreen
            title="Loading admin"
            description="Preparing the administration workspace..."
            variant="loading"
        />
    );
}
