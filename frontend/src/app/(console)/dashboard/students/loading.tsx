import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level loading state. Without one, navigation to this page shows the
 * previous screen frozen while data loads, which reads as an unresponsive app.
 */
export default function StudentsLoading() {
    return <RouteStateScreen title="Loading students" description="Fetching your student roster…" variant="loading" />;
}
