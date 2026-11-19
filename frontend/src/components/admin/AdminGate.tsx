'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

/**
 * A blocking state of the admin console — no wallet connected, or the wrong
 * wallet connected.
 *
 * These states leave nothing for the admin to do but fix them, so the gate is
 * the only thing on the page and is centred in the content area rather than
 * left as a small card above half a viewport of nothing
 * (ACREDIA-STELLAR#225).
 */
export function AdminGate({
    icon: Icon,
    title,
    message,
    children,
}: {
    icon: LucideIcon;
    title: string;
    message: string;
    /** The action or detail block shown under the message. */
    children?: ReactNode;
}) {
    return (
        <div className="flex min-h-[calc(100dvh-16rem)] items-center justify-center lg:min-h-[calc(100dvh-12rem)]">
            <Card className="w-full max-w-xl border-warning/30 bg-warning/8 p-8 text-center sm:p-10">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/15 text-warning">
                    <Icon className="h-8 w-8" />
                </span>
                <h2 className="mt-6 text-xl font-bold tracking-tight text-foreground">{title}</h2>
                {/* Held to a readable measure rather than the full card width. */}
                <p className="mx-auto mt-2.5 max-w-prose text-sm leading-6 text-muted-foreground">
                    {message}
                </p>
                {children && <div className="mt-7">{children}</div>}
            </Card>
        </div>
    );
}
