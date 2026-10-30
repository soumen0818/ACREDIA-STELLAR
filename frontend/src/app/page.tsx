'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    Award,
    Building2,
    CheckCircle2,
    Fingerprint,
    Globe2,
    GraduationCap,
    Lock,
    QrCode,
    ShieldCheck,
    Sparkles,
    Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';

const fadeUp = {
    initial: { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-80px' },
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

const heroStats = [
    { value: '3–5s', label: 'To verify a credential' },
    { value: '<$0.01', label: 'Cost per credential' },
    { value: '100%', label: 'Tamper-proof records' },
];

const steps = [
    {
        icon: Building2,
        step: '01',
        title: 'Institutions issue',
        description:
            'Verified institutions anchor each credential on Stellar, while its document stays private and fingerprinted on-chain.',
    },
    {
        icon: GraduationCap,
        step: '02',
        title: 'Students own',
        description:
            'Graduates keep their credentials for life in a personal, wallet-linked dashboard — and share them anytime.',
    },
    {
        icon: QrCode,
        step: '03',
        title: 'Anyone verifies',
        description:
            'Employers scan a QR code or open a link to confirm authenticity in seconds — no phone calls, no waiting.',
    },
];

const features = [
    {
        icon: ShieldCheck,
        title: 'Tamper-proof by design',
        description:
            'Every credential is anchored to the Stellar blockchain. Once issued, it cannot be forged or altered.',
    },
    {
        icon: Zap,
        title: 'Instant verification',
        description:
            'Verify authenticity from a QR code or shareable link in seconds — from anywhere in the world.',
    },
    {
        icon: Award,
        title: 'Owned by students',
        description:
            'Credentials belong to the graduate for life, independent of any single institution or portal.',
    },
    {
        icon: Fingerprint,
        title: 'Privacy-preserving',
        description:
            'Verification relies on cryptographic hashes, so sensitive personal data is never exposed publicly.',
    },
    {
        icon: Globe2,
        title: 'Global & low-cost',
        description:
            'Built on Stellar for sub-cent fees and fast settlement, making issuance affordable at any scale.',
    },
    {
        icon: Lock,
        title: 'Institution controls',
        description:
            'Authorized issuers manage issuance and revocation with a clear, auditable trail of every action.',
    },
];


export default function Home() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />

            <main id="main">
                {/* ── Hero ─────────────────────────────────────────────── */}
                <section className="relative overflow-hidden bg-app-wash">
                    <div className="container-shell relative grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:gap-8 lg:py-28">
                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                            className="max-w-xl"
                        >
                            <span className="badge-gold">
                                <Sparkles className="h-3.5 w-3.5" />
                                Academic credentials on Stellar
                            </span>

                            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                                Tamper-proof credentials,{' '}
                                <span className="text-gradient-gold">verifiable by anyone.</span>
                            </h1>

                            <p className="mt-6 text-lg leading-8 text-muted-foreground">
                                Acredia lets institutions issue blockchain-secured academic
                                credentials, gives students lifelong ownership, and lets employers
                                verify authenticity in seconds.
                            </p>

                            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                <Button asChild size="xl">
                                    <Link href="/contact">
                                        Request access
                                        <ArrowRight className="h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button asChild size="xl" variant="outline">
                                    <Link href="/verify">
                                        <QrCode className="h-5 w-5" />
                                        Verify a credential
                                    </Link>
                                </Button>
                            </div>

                            <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-border pt-8">
                                {heroStats.map((stat) => (
                                    <div key={stat.label}>
                                        <dd className="text-2xl font-bold text-foreground sm:text-3xl">
                                            {stat.value}
                                        </dd>
                                        <dt className="mt-1 text-xs text-muted-foreground sm:text-sm">
                                            {stat.label}
                                        </dt>
                                    </div>
                                ))}
                            </dl>
                        </motion.div>

                        {/* Hero visual */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                            className="relative mx-auto w-full max-w-[260px] sm:max-w-xs lg:ml-auto lg:mr-0 lg:max-w-md"
                        >
                            <motion.div
                                animate={{ y: [0, -14, 0] }}
                                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                            >
                                <Image
                                    src="/auth-illustration.png"
                                    alt="Students holding verified academic credentials secured on the Stellar blockchain"
                                    width={960}
                                    height={1130}
                                    priority
                                    className="h-auto w-full"
                                />
                            </motion.div>
                        </motion.div>
                    </div>
                </section>

                {/* ── How it works ─────────────────────────────────────── */}
                <section className="section-pad">
                    <div className="container-shell">
                        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">How it works</span>
                            <h2 className="section-heading mt-3">
                                From issuance to verification in three steps
                            </h2>
                            <p className="section-copy mx-auto mt-4 text-center">
                                A single, trusted flow that connects institutions, students, and the
                                people who need to verify credentials.
                            </p>
                        </motion.div>

                        <div className="mt-14 grid gap-6 md:grid-cols-3">
                            {steps.map((step, i) => (
                                <motion.div
                                    key={step.title}
                                    {...fadeUp}
                                    transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                                    className="relative rounded-2xl border border-border bg-card p-7 shadow-sm transition-shadow hover:shadow-md"
                                >
                                    <span className="text-sm font-bold text-gold">{step.step}</span>
                                    <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                        <step.icon className="h-6 w-6" />
                                    </div>
                                    <h3 className="mt-5 text-lg font-semibold text-foreground">
                                        {step.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        {step.description}
                                    </p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── Features ─────────────────────────────────────────── */}
                <section className="section-pad bg-secondary/40">
                    <div className="container-shell">
                        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">Why Acredia</span>
                            <h2 className="section-heading mt-3">
                                Built for trust at every step
                            </h2>
                            <p className="section-copy mx-auto mt-4 text-center">
                                Everything you need to eliminate credential fraud and make
                                verification effortless.
                            </p>
                        </motion.div>

                        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {features.map((feature, i) => (
                                <motion.div
                                    key={feature.title}
                                    {...fadeUp}
                                    transition={{ ...fadeUp.transition, delay: (i % 3) * 0.06 }}
                                    className="group rounded-2xl border border-border bg-card p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
                                >
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                        <feature.icon className="h-6 w-6" />
                                    </div>
                                    <h3 className="mt-5 text-lg font-semibold text-foreground">
                                        {feature.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        {feature.description}
                                    </p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── Audience split ───────────────────────────────────── */}
                <section className="section-pad">
                    <div className="container-shell grid gap-6 lg:grid-cols-2">
                        {[
                            {
                                icon: Building2,
                                eyebrow: 'For institutions',
                                title: 'Issue credentials your graduates can rely on',
                                points: [
                                    'Mint tamper-proof credentials in a few clicks',
                                    'Manage authorization and revocation with an audit trail',
                                    'Reduce verification requests and administrative overhead',
                                ],
                                href: '/solutions/institutions',
                                cta: 'Explore for institutions',
                            },
                            {
                                icon: GraduationCap,
                                eyebrow: 'For students',
                                title: 'Own and share your achievements for life',
                                points: [
                                    'Keep every credential in one secure dashboard',
                                    'Share a verifiable link or QR code instantly',
                                    'No dependence on a single institution or portal',
                                ],
                                href: '/solutions/students',
                                cta: 'Explore for students',
                            },
                        ].map((card) => (
                            <motion.div
                                key={card.eyebrow}
                                {...fadeUp}
                                className="flex flex-col rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"
                            >
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <card.icon className="h-6 w-6" />
                                </div>
                                <span className="eyebrow mt-6">{card.eyebrow}</span>
                                <h3 className="mt-2 text-2xl font-semibold text-foreground">
                                    {card.title}
                                </h3>
                                <ul className="mt-6 space-y-3">
                                    {card.points.map((point) => (
                                        <li key={point} className="flex items-start gap-3">
                                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                                            <span className="text-sm text-muted-foreground">
                                                {point}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="mt-8 pt-2">
                                    <Button asChild variant="outline">
                                        <Link href={card.href}>
                                            {card.cta}
                                            <ArrowRight className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* ── Final CTA ────────────────────────────────────────── */}
                <section className="pb-20 sm:pb-24">
                    <div className="container-shell">
                        <motion.div
                            {...fadeUp}
                            className="relative overflow-hidden rounded-3xl bg-brand-mesh px-6 py-16 text-center sm:px-12"
                        >
                            <div className="relative mx-auto max-w-2xl">
                                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                    Ready to make credentials fraud-proof?
                                </h2>
                                <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">
                                    Join Acredia and start issuing or verifying blockchain-secured
                                    academic credentials today.
                                </p>
                                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                                    <Button asChild size="xl" variant="gold">
                                        <Link href="/contact">
                                            Request access
                                            <ArrowRight className="h-5 w-5" />
                                        </Link>
                                    </Button>
                                    <Button
                                        asChild
                                        size="xl"
                                        variant="outline"
                                        className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                                    >
                                        <Link href="/verify">Verify a credential</Link>
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    );
}
