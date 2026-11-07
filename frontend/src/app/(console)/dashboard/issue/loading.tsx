import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level loading state. Without one, navigation to this page shows the
 * previous screen frozen while data loads, which reads as an unresponsive app.
 */
export default function IssueLoading() {
    return <RouteStateScreen title="Loading issuance form" description="Preparing the credential issuance form…" variant="loading" />;
}
