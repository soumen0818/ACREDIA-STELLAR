'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import { ConnectWallet } from '@/components/ui/ConnectWallet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { activeNetwork } from '@/lib/stellar';
import { isConsoleNavItemActive, type ConsoleNav } from '@/lib/consoleNav';
import { useAuth } from '@/contexts/AuthContext';

interface ConsoleShellProps {
    /**
     * Sidebar definition for the signed-in role — items, badge, and the
     * accessible name of the nav landmark. Pass one of the maps from
     * `@/lib/consoleNav` rather than hardcoding links here.
     */
    nav: ConsoleNav;
    /**
     * Page heading. Omit it when the sidebar already names the page and a
     * heading would only repeat it.
     */
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Rendered on the right of the page header — filters, refresh, etc. */
    actions?: ReactNode;
    children: ReactNode;
    /** Overrides the default "sign out, then go home" behaviour. */
    onSignOut?: () => void;
}

function BrandBadge({ label }: { label: string }) {
    return (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            {label}
        </span>
    );
}

function SidebarContent({
    nav,
    onNavigate,
    onSignOut,
}: {
    nav: ConsoleNav;
    onNavigate?: () => void;
    onSignOut: () => void;
}) {
    const pathname = usePathname();
    const { user } = useAuth();
    const email = user?.email;

    return (
        <div className="flex h-full flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
                <Link
                    href="/"
                    className="flex items-center gap-2.5"
                    aria-label="Acredia home"
                    onClick={onNavigate}
                >
                    <Image
                        src="/logo.png"
                        alt=""
                        width={34}
                        height={34}
                        className="h-8 w-8 object-contain"
                    />
                    <span className="text-lg font-bold leading-none tracking-tight text-foreground">
                        Acredia
                    </span>
                </Link>
                <BrandBadge label={nav.badge} />
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label={nav.navLabel}>
                {nav.items.map((item) => {
                    const Icon = item.icon;
                    const active = isConsoleNavItemActive(pathname, item);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                                'flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                                active
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                            )}
                        >
                            <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold leading-tight">
                                    {item.label}
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {item.description}
                                </span>
                            </span>
                        </Link>
                    );
                })}
            </nav>

            {/* Account identity, wallet state, and account actions each get
                their own band so they never read as one undifferentiated blob
                (ACREDIA-STELLAR#225). */}
            <div className="shrink-0 border-t border-border">
                {email && (
                    <div className="px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Signed in as
                        </p>
                        <p
                            className="mt-0.5 truncate text-sm font-medium text-foreground"
                            title={email}
                        >
                            {email}
                        </p>
                    </div>
                )}

                <div className="space-y-3 border-t border-border p-3">
                    {activeNetwork.kind === 'testnet' && (
                        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                                Stellar Testnet
                            </span>
                        </div>
                    )}

                    <div className="[&>*]:w-full">
                        <ConnectWallet />
                    </div>

                    <Button
                        onClick={onSignOut}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </Button>
                </div>
            </div>
        </div>
    );
}

/**
 * The one console layout shared by the admin, institution, and student
 * consoles: a fixed sidebar on desktop, a drawer on mobile, and account
 * actions pinned to the sidebar footer.
 *
 * Everything role-specific arrives through the `nav` prop, so this component
 * never needs to know which role is signed in.
 */
interface ConsolePageProps {
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Rendered on the right of the header — filters, refresh, etc. */
    actions?: ReactNode;
    children?: ReactNode;
}

/**
 * The per-page header inside a console.
 *
 * Kept separate from `ConsoleShell` so the shell — sidebar, mobile drawer, auth
 * gate — can live in a route `layout.tsx` and persist across navigation, while
 * each page supplies only its own heading. Previously every page rendered its
 * own `ConsoleShell`, so React unmounted and rebuilt the entire sidebar on each
 * link click: the sidebar vanished for roughly a frame and came back as a new
 * DOM node, which looked exactly like a full page reload.
 */
export function ConsolePage({ title, subtitle, actions, children }: ConsolePageProps) {
    return (
        <>
            {(title || actions) && (
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    {title && (
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                                {title}
                            </h1>
                            {subtitle && <p className="mt-1.5 text-muted-foreground">{subtitle}</p>}
                        </div>
                    )}
                    {actions && (
                        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{actions}</div>
                    )}
                </div>
            )}
            {children}
        </>
    );
}

export function ConsoleShell({
    nav,
    title,
    subtitle,
    actions,
    children,
    onSignOut,
}: ConsoleShellProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { signOut } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Every console signs out the same way; pages only pass `onSignOut` when
    // they need something other than "sign out, then go home".
    const handleSignOut = useCallback(async () => {
        if (onSignOut) {
            onSignOut();
            return;
        }
        await signOut();
        router.push('/');
    }, [onSignOut, router, signOut]);

    // Close the drawer on navigation so the new page is not hidden behind it.
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    // Prevent the page behind the drawer from scrolling while it is open.
    useEffect(() => {
        if (!mobileOpen) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [mobileOpen]);

    useEffect(() => {
        if (!mobileOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMobileOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [mobileOpen]);

    return (
        <div className="min-h-dvh bg-secondary/30">
            {/* Desktop sidebar */}
            <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-background lg:block">
                <SidebarContent nav={nav} onSignOut={handleSignOut} />
            </aside>

            {/* Mobile drawer */}
            {mobileOpen && (
                <div className="lg:hidden">
                    <button
                        type="button"
                        aria-label="Close navigation"
                        className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    />
                    <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-background shadow-xl">
                        <SidebarContent
                            nav={nav}
                            onSignOut={handleSignOut}
                            onNavigate={() => setMobileOpen(false)}
                        />
                    </aside>
                </div>
            )}

            <div className="lg:pl-64">
                {/* Mobile top bar — only holds the drawer toggle. */}
                <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl lg:hidden">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMobileOpen((open) => !open)}
                        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={mobileOpen}
                    >
                        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </Button>
                    <Image
                        src="/logo.png"
                        alt=""
                        width={30}
                        height={30}
                        className="h-7 w-7 object-contain"
                    />
                    <span className="text-base font-bold tracking-tight text-foreground">
                        Acredia
                    </span>
                    <BrandBadge label={nav.badge} />
                </header>

                <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                    {/* A title passed directly to the shell still renders, so
                        callers that have not moved to <ConsolePage> keep
                        working unchanged. */}
                    {(title || actions) && (
                        <ConsolePage title={title} subtitle={subtitle} actions={actions} />
                    )}
                    {children}
                </main>
            </div>
        </div>
    );
}
