import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminInstitutionsLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="mt-2 h-4 w-72" />
                </div>
                <Skeleton className="h-9 w-32" />
            </div>

            <Card className="p-6">
                <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-border pb-4">
                        <Skeleton className="h-6 w-36" />
                        <Skeleton className="h-8 w-64" />
                    </div>
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex items-center justify-between py-3">
                            <div className="space-y-1">
                                <Skeleton className="h-5 w-44" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                            <Skeleton className="h-6 w-20 rounded-full" />
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
