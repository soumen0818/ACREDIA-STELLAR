import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function CredentialLoading() {
    return (
        <div className="min-h-dvh bg-secondary/30">
            <SiteNavbar />

            <main className="container mx-auto px-4 py-12">
                <div className="max-w-4xl mx-auto space-y-8">
                    <div className="text-center space-y-2">
                        <Skeleton className="h-9 w-72 mx-auto" />
                        <Skeleton className="h-5 w-96 mx-auto" />
                    </div>

                    <Card className="p-8 space-y-6">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-6 w-32" />
                            <Skeleton className="h-6 w-24 rounded-full" />
                        </div>
                        <Skeleton className="h-10 w-3/4" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                        <div className="space-y-2 pt-4">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-5/6" />
                        </div>
                    </Card>
                </div>
            </main>
        </div>
    );
}
