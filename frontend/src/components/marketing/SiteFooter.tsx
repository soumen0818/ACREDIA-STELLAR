import Image from 'next/image';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { NetworkBadge } from '@/components/marketing/NetworkBadge';

const footerNav: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
        heading: 'Product',
        links: [
            { label: 'Verified Issuers', href: '/issuers' },
            { label: 'Verify a credential', href: '/verify' },
            { label: 'For institutions', href: '/solutions/institutions' },
            { label: 'For students', href: '/solutions/students' },
            { label: 'About', href: '/about' },
        ],
    },
    {
        heading: 'Account',
        links: [
            { label: 'Student login', href: '/auth/login?role=student' },
            { label: 'Institution login', href: '/auth/login?role=institution' },
            { label: 'Administrative login', href: '/auth/admin-login' },
        ],
    },
    {
        heading: 'Resources',
        links: [
            { label: 'Stellar Network', href: 'https://stellar.org', external: true },
            { label: 'Stellar Explorer', href: 'https://stellar.expert', external: true },
            { label: 'Contact us', href: '/contact' },
        ],
    },
    {
        heading: 'Legal',
        links: [
            { label: 'Privacy Policy', href: '/legal/privacy' },
            { label: 'Terms of Service', href: '/legal/terms' },
            { label: 'Data Processing Agreement', href: '/legal/dpa' },
        ],
    },
];

export function SiteFooter() {
    return (
        <footer className="border-t border-border bg-secondary/40">
            <div className="container-shell py-14">
                <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
                    <div className="max-w-xs">
                        <Link href="/" className="flex items-center gap-2.5" aria-label="Acredia home">
                            <Image
                                src="/Acredia.png"
                                alt=""
                                width={36}
                                height={36}
                                className="h-9 w-9 object-contain"
                            />
                            <span className="text-lg font-bold tracking-tight text-foreground">
                                Acredia
                            </span>
                        </Link>
                        <p className="mt-4 text-sm leading-6 text-muted-foreground">
                            Tamper-proof academic credentials on the Stellar network — issued by
                            institutions, owned by students, verifiable by anyone in seconds.
                        </p>
                        <NetworkBadge className="mt-5" />
                    </div>

                    {footerNav.map((column) => (
                        <div key={column.heading}>
                            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                {column.heading}
                            </h3>
                            <ul className="mt-4 space-y-3">
                                {column.links.map((link) => (
                                    <li key={link.label}>
                                        {link.external ? (
                                            <a
                                                href={link.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                                            >
                                                {link.label}
                                            </a>
                                        ) : (
                                            <Link
                                                href={link.href}
                                                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                                            >
                                                {link.label}
                                            </Link>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
                    <p className="text-sm text-muted-foreground">
                        © {new Date().getFullYear()} Acredia. All rights reserved.
                    </p>
                    <div className="flex items-center gap-5">
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <ShieldCheck className="h-4 w-4 text-success" />
                            Blockchain-secured
                        </span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
