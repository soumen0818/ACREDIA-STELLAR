import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuthLoading() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
            <Card className="w-full max-w-md p-8 space-y-6">
                <div className="text-center space-y-2">
                    <Skeleton className="h-8 w-40 mx-auto" />
                    <Skeleton className="h-4 w-60 mx-auto" />
                </div>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <Skeleton className="h-11 w-full" />
                </div>
            </Card>
        </div>
    );
}
