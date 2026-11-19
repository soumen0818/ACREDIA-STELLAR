'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ChevronDown, GraduationCap, Menu, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { activeNetwork } from '@/lib/stellar';

const solutions = [
    {
        href: '/solutions/institutions',
        title: 'For Institutions',
        description: 'Issue and manage tamper-proof credentials',
        icon: Building2,
    },
    {
        href: '/solutions/students',
        title: 'For Students',
        description: 'Hold, verify and share your achievements',
        icon: GraduationCap,
    },
];

const navLinks = [
    { href: '/verify', label: 'Verify' },
    { href: '/issuers', label: 'Issuers' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
];

export function SiteNavbar() {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileSolutionsOpen, setMobileSolutionsOpen] = useState(false);
    const [solutionsOpen, setSolutionsOpen] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Close menus on route change
    useEffect(() => {
        setMobileOpen(false);
        setMobileSolutionsOpen(false);
        setSolutionsOpen(false);
    }, [pathname]);

    // Lock body scroll while the mobile sheet is open
    useEffect(() => {
        document.body.style.overflow = mobileOpen ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [mobileOpen]);

    const openSolutions = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setSolutionsOpen(true);
    };
    const scheduleCloseSolutions = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setSolutionsOpen(false), 160);
    };

    const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

    return (
        <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl">
            <nav className="container-shell flex h-16 items-center justify-between gap-4" aria-label="Primary">
                {/* Brand */}
                <Link href="/" className="flex items-center gap-2.5" aria-label="Acredia home">
                    <Image
                        src="/logo.png"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 object-contain"
                        priority
                    />
                    <div className="flex flex-col">
                        <span className="text-lg font-bold leading-none tracking-tight text-foreground">
                            Acredia
                        </span>
                        {activeNetwork.kind === 'testnet' && (
                            <span className="mt-1 w-fit rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-800">
                                Testnet
                            </span>
                        )}
                    </div>
                </Link>

                {/* Desktop nav */}
                <div className="hidden items-center gap-1 md:flex">
                    <div
                        className="relative"
                        onMouseEnter={openSolutions}
                        onMouseLeave={scheduleCloseSolutions}
                    >
                        <button
                            type="button"
                            className={cn(
                                'inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                                solutionsOpen && 'bg-secondary text-foreground',
                            )}
                            aria-expanded={solutionsOpen}
                            aria-haspopup="true"
                            onClick={() => setSolutionsOpen((v) => !v)}
                        >
                            Solutions
                            <ChevronDown
                                className={cn(
                                    'h-4 w-4 transition-transform',
                                    solutionsOpen && 'rotate-180',
                                )}
                            />
                        </button>

                        {solutionsOpen && (
                            <div
                                className="absolute left-0 top-full w-[360px] pt-2"
                                onMouseEnter={openSolutions}
                                onMouseLeave={scheduleCloseSolutions}
                            >
                                <div className="overflow-hidden rounded-2xl border border-border bg-popover p-2 shadow-lg">
                                    {solutions.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-secondary"
                                        >
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                <item.icon className="h-5 w-5" />
                                            </span>
                                            <span>
                                                <span className="block text-sm font-semibold text-foreground">
                                                    {item.title}
                                                </span>
                                                <span className="block text-xs text-muted-foreground">
                                                    {item.description}
                                                </span>
                                            </span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                                'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary hover:text-foreground',
                                isActive(link.href) ? 'text-foreground' : 'text-muted-foreground',
                            )}
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>

                {/* Desktop actions */}
                <div className="hidden items-center gap-2 md:flex">
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/auth/login">Sign in</Link>
                    </Button>
                    <Button asChild size="sm">
                        <Link href="/contact">Request access</Link>
                    </Button>
                </div>

                {/* Mobile trigger */}
                <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary md:hidden"
                    aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                    aria-expanded={mobileOpen}
                    onClick={() => setMobileOpen((v) => !v)}
                >
                    {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
            </nav>

            {/* Mobile sheet */}
            {mobileOpen && (
                <div className="border-t border-border bg-background md:hidden">
                    <div className="container-shell space-y-1 py-4">
                        <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
                            onClick={() => setMobileSolutionsOpen((v) => !v)}
                            aria-expanded={mobileSolutionsOpen}
                        >
                            Solutions
                            <ChevronDown
                                className={cn(
                                    'h-4 w-4 transition-transform',
                                    mobileSolutionsOpen && 'rotate-180',
                                )}
                            />
                        </button>
                        {mobileSolutionsOpen && (
                            <div className="space-y-1 pl-2">
                                {solutions.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary"
                                    >
                                        <item.icon className="h-4 w-4 text-primary" />
                                        <span className="text-sm text-foreground">{item.title}</span>
                                    </Link>
                                ))}
                            </div>
                        )}

                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
                            >
                                {link.href === '/verify' && <ShieldCheck className="h-4 w-4 text-primary" />}
                                {link.label}
                            </Link>
                        ))}

                        <div className="grid grid-cols-2 gap-2 pt-3">
                            <Button asChild variant="outline">
                                <Link href="/auth/login">Sign in</Link>
                            </Button>
                            <Button asChild>
                                <Link href="/contact">Request access</Link>
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
}
