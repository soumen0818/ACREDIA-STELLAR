import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';

interface RouteStateScreenProps {
    title: string;
    description: string;
    actionLabel?: string;
    secondaryActionLabel?: string;
    onAction?: () => void;
    onSecondaryAction?: () => void;
    variant?: 'error' | 'loading' | 'not-found';
}

export function RouteStateScreen({
    title,
    description,
    actionLabel,
    secondaryActionLabel,
    onAction,
    onSecondaryAction,
    variant = 'error',
}: RouteStateScreenProps) {
    const isLoading = variant === 'loading';

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-cyan-50 to-teal-50 px-4 py-12">
            <Card className="w-full max-w-2xl border border-slate-200 bg-white/90 p-8 shadow-xl backdrop-blur">
                <div className="flex flex-col items-center text-center">
                    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-cyan-600 text-white shadow-lg">
                        {isLoading ? (
                            <Loader2 className="h-8 w-8 animate-spin" />
                        ) : variant === 'not-found' ? (
                            <ShieldCheck className="h-8 w-8" />
                        ) : (
                            <AlertCircle className="h-8 w-8" />
                        )}
                    </div>
                    <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-teal-600">
                        ACREDIA
                    </p>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
                    <p className="mt-4 max-w-xl text-lg leading-8 text-slate-600">{description}</p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        {actionLabel ? (
                            <Button onClick={onAction} className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white">
                                {actionLabel}
                            </Button>
                        ) : null}
                        {secondaryActionLabel ? (
                            <Button variant="outline" asChild onClick={onSecondaryAction}>
                                <Link href="/">{secondaryActionLabel}</Link>
                            </Button>
                        ) : null}
                    </div>
                </div>
            </Card>
        </div>
    );
}
