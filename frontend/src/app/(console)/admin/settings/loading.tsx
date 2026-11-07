import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminSettingsLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-80" />
            </div>

            <Card className="p-6 max-w-2xl space-y-6">
                <div className="space-y-3">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-10 w-full" />
                </div>
                <div className="space-y-3">
                    <Skeleton className="h-5 w-44" />
                    <Skeleton className="h-10 w-full" />
                </div>
            </Card>
        </div>
    );
}
