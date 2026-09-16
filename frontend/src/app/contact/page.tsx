import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Building2, GraduationCap, Mail, MessageSquare, ShieldCheck } from 'lucide-react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { ContactForm } from '@/components/marketing/ContactForm';
import { CONTACT_EMAIL, CONTACT_MAILTO, TWITTER_HANDLE, TWITTER_URL, hasTwitter } from '@/lib/contact';

export const metadata: Metadata = {
    title: 'Contact — Acredia',
    description:
        'Get in touch with the Acredia team about issuing credentials, verification, partnerships, or support.',
};

function XMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
            <path d="M18.9 2.2h3.4l-7.5 8.6 8.8 11.6h-6.9l-5.4-7-6.2 7H1.7l8-9.2L1.3 2.2h7.1l4.9 6.4 5.6-6.4Zm-1.2 18.2h1.9L6.4 4.1H4.4l13.3 16.3Z" />
        </svg>
    );
}

const reasons = [
    {
        icon: Building2,
        title: 'For institutions',
        description:
            'Want to issue verifiable credentials to your graduates? Tell us about your programme and we’ll walk you through onboarding.',
    },
    {
        icon: GraduationCap,
        title: 'For students',
        description:
            'Trouble accessing or sharing a credential? Include your token ID and we’ll look into it.',
    },
    {
        icon: ShieldCheck,
        title: 'Security reports',
        description:
            'Found a vulnerability? Email us directly instead of opening a public issue, and we’ll respond quickly.',
    },
];

export default function ContactPage() {
    return (
        <div className="flex min-h-screen flex-col">
            <SiteNavbar />

            <main className="flex-1">
                {/* Hero */}
                <section className="bg-app-wash">
                    <div className="container-shell py-14 text-center sm:py-20">
                        <span className="badge-gold">
                            <MessageSquare className="h-3.5 w-3.5" />
                            Contact us
                        </span>
                        <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
                            Let&apos;s talk about{' '}
                            <span className="text-gradient-gold">credentials you can trust.</span>
                        </h1>
                        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
                            Questions about issuing, verifying, or integrating Acredia? Send us a
                            message and we&apos;ll get back to you by email.
                        </p>
                    </div>
                </section>

                {/* Form + info */}
                <section className="section-pad pt-12">
                    <div className="container-shell grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
                        {/* Left: illustration + direct channels */}
                        <div className="order-2 lg:order-1">
                            <Image
                                src="/auth-illustration.png"
                                alt="Students sharing verified academic credentials"
                                width={960}
                                height={1130}
                                className="mx-auto hidden w-full max-w-sm lg:block"
                                priority
                            />

                            <div className="mt-8 space-y-3">
                                <a
                                    href={CONTACT_MAILTO}
                                    className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
                                >
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                        <Mail className="h-5 w-5" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-foreground">
                                            Email us
                                        </span>
                                        <span className="block truncate text-sm text-muted-foreground">
                                            {CONTACT_EMAIL}
                                        </span>
                                    </span>
                                </a>

                                {/* Rendered only when a real handle is configured —
                                    see hasTwitter in @/lib/contact. */}
                                {hasTwitter && (
                                    <a
                                        href={TWITTER_URL as string}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
                                    >
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                            <XMark className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold text-foreground">
                                                Follow us on X
                                            </span>
                                            <span className="block truncate text-sm text-muted-foreground">
                                                {TWITTER_HANDLE}
                                            </span>
                                        </span>
                                    </a>
                                )}
                            </div>

                            <p className="mt-6 text-sm text-muted-foreground">
                                New to Acredia? Read{' '}
                                <Link
                                    href="/about"
                                    className="font-medium text-primary hover:underline"
                                >
                                    how it works
                                </Link>{' '}
                                first — and please send security reports by email rather than
                                sharing them publicly.
                            </p>
                        </div>

                        {/* Right: the form */}
                        <div className="order-1 lg:order-2">
                            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
                                <h2 className="text-xl font-semibold text-foreground">
                                    Send us a message
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    We typically reply within a couple of business days.
                                </p>
                                <div className="mt-6">
                                    <ContactForm />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Reasons */}
                <section className="pb-20 sm:pb-24">
                    <div className="container-shell grid gap-6 md:grid-cols-3">
                        {reasons.map((reason) => (
                            <div
                                key={reason.title}
                                className="rounded-2xl border border-border bg-card p-7 shadow-sm"
                            >
                                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <reason.icon className="h-5 w-5" />
                                </span>
                                <h3 className="mt-5 text-base font-semibold text-foreground">
                                    {reason.title}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                    {reason.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    );
}
