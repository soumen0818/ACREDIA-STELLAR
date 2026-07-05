import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

export default function DashboardLoading() {
    return (
        <RouteStateScreen
            title="Loading dashboard"
            description="Preparing your workspace and credentials..."
            variant="loading"
        />
    );
}
