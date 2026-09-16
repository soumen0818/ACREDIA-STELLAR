'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { NetworkBadge } from '@/components/marketing/NetworkBadge';

const highlights = [
    'Issue tamper-proof credentials in minutes',
    'Students own their achievements for life',
    'Anyone can verify authenticity in seconds',
];

interface AuthShellProps {
    title: ReactNode;
    subtitle?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    /** Optional accent for the brand panel (e.g. admin). */
    variant?: 'default' | 'admin';
}

export function AuthShell({ title, subtitle, children, footer, variant = 'default' }: AuthShellProps) {
    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            {/* Brand panel */}
            <div className="relative hidden flex-col overflow-hidden bg-brand-mesh px-10 py-10 lg:flex xl:px-14">
                {/* Top: brand + value points (above the illustration) */}
                <div className="relative z-10">
                    <Link href="/" className="flex items-center gap-2.5">
                        <Image
                            src="/Acredia.png"
                            alt=""
                            width={40}
                            height={40}
                            className="h-10 w-10 object-contain"
                        />
                        <span className="text-xl font-bold tracking-tight text-white">Acredia</span>
                    </Link>

                    <h2 className="mt-9 max-w-md text-3xl font-bold leading-tight tracking-tight text-white">
                        {variant === 'admin'
                            ? 'Administrator console access.'
                            : 'Credentials the world can trust.'}
                    </h2>
                    <ul className="mt-6 space-y-3">
                        {highlights.map((item) => (
                            <li key={item} className="flex items-start gap-3">
                                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
                                <span className="text-sm text-white/85">{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Illustration fills the rest of the panel */}
                <div className="relative mt-6 flex-1">
                    <Image
                        src="/auth-illustration.png"
                        alt="Students holding verified academic credentials secured on the Stellar blockchain"
                        fill
                        sizes="(min-width: 1024px) 45vw, 0px"
                        className="object-contain object-bottom"
                        priority
                    />
                </div>

                {/* Bottom: network status */}
                <NetworkBadge className="relative z-10 mt-4" tone="inverted" />
            </div>

            {/* Form panel */}
            <div className="flex min-h-screen flex-col justify-center bg-background px-5 py-10 sm:px-6 lg:min-h-0 lg:px-12">
                <div className="mx-auto w-full max-w-md">
                    {/* Mobile brand + illustration (desktop shows these in the left panel) */}
                    <div className="mb-7 flex flex-col items-center lg:hidden">
                        <Link
                            href="/"
                            className="flex items-center gap-2.5"
                            aria-label="Acredia home"
                        >
                            <Image
                                src="/Acredia.png"
                                alt=""
                                width={34}
                                height={34}
                                className="h-8 w-8 object-contain"
                            />
                            <span className="text-lg font-bold tracking-tight text-foreground">
                                Acredia
                            </span>
                        </Link>
                        <Image
                            src="/auth-illustration.png"
                            alt="Students holding verified academic credentials secured on the Stellar blockchain"
                            width={480}
                            height={565}
                            priority
                            className="mt-5 w-full max-w-[220px] sm:max-w-[240px]"
                        />
                    </div>

                    <div className="mb-8 text-center lg:text-left">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
                        )}
                    </div>

                    {children}

                    {footer && <div className="mt-8">{footer}</div>}

                    <div className="mt-8 flex justify-center border-t border-border pt-6 lg:justify-start">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to home
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
