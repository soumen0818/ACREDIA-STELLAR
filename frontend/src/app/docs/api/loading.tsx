import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocsApiLoading() {
    return (
        <div className="min-h-dvh bg-background py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto space-y-8">
                <div className="space-y-2">
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-32" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-5/6" />
                    </div>

                    <div className="lg:col-span-3 space-y-6">
                        <Card className="p-6 space-y-4">
                            <Skeleton className="h-7 w-48" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-32 w-full font-mono" />
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
