import { RouteStateScreen } from '@/components/route-state/RouteStateScreen';

/**
 * Route-level loading state. Without one, navigation to this page shows the
 * previous screen frozen while data loads, which reads as an unresponsive app.
 */
export default function WalletLoading() {
    return <RouteStateScreen title="Loading wallet" description="Checking your connected wallet…" variant="loading" />;
}
