import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminInstitutionDetailLoading() {
    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-60" />
                <Skeleton className="h-9 w-32" />
            </div>

            <Card className="p-6">
                <div className="flex items-center gap-3 mb-6">
                    <Skeleton className="h-12 w-12 rounded-2xl" />
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </Card>

            <Card className="p-6">
                <Skeleton className="h-6 w-40 mb-4" />
                <Skeleton className="h-24 w-full" />
            </Card>
        </div>
    );
}
