'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    Boxes,
    Database,
    FileWarning,
    KeyRound,
    Layers,
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

const problems = [
    'Paper and PDF credentials are easy to forge or alter',
    'Verifying a degree can take days of manual back-and-forth',
    'Records are lost when a portal shuts down or a student loses access',
    'Centralized databases are a single point of failure',
];

const solutions = [
    'Credentials are anchored to the Stellar blockchain and cannot be altered',
    'Anyone can verify authenticity in seconds from a link or QR code',
    'Students own their records for life, independent of any portal',
    'Decentralized storage removes single points of failure',
];

const architecture = [
    {
        icon: Layers,
        title: 'Stellar Network',
        description:
            'A fast, low-cost, energy-efficient blockchain that settles transactions in 3–5 seconds for under a cent.',
    },
    {
        icon: Boxes,
        title: 'Soroban Contracts',
        description:
            'Rust-based smart contracts handle credential issuance, registry lookups, authorization, and revocation.',
    },
    {
        icon: Database,
        title: 'Private Document Storage',
        description:
            'Credential documents are stored privately and fingerprinted on-chain, so anyone given a share link can prove a document is the one issued.',
    },
    {
        icon: KeyRound,
        title: 'Access Control',
        description:
            'Only authorized institutions can issue, with a clear, auditable trail of every action.',
    },
];

const stats = [
    { value: '3–5s', label: 'Settlement time' },
    { value: '<$0.01', label: 'Per transaction' },
    { value: '100%', label: 'Tamper-proof' },
    { value: '24/7', label: 'Verifiable' },
];

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />

            <main>
                {/* Hero */}
                <section className="bg-app-wash">
                    <div className="container-shell py-16 text-center sm:py-24">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="mx-auto max-w-3xl"
                        >
                            <span className="badge-gold">
                                <Sparkles className="h-3.5 w-3.5" />
                                Our mission
                            </span>
                            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                                Building trust in{' '}
                                <span className="text-gradient-gold">academic credentials.</span>
                            </h1>
                            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                                Acredia is a decentralized platform that transforms how academic
                                credentials are issued, stored, and verified — eliminating fraud and
                                giving students lifelong ownership of their achievements on the
                                Stellar network.
                            </p>
                        </motion.div>
                    </div>
                </section>

                {/* Stats band */}
                <section className="border-y border-border bg-muted">
                    <div className="container-shell grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
                        {stats.map((stat, i) => (
                            <motion.div
                                key={stat.label}
                                initial={{ opacity: 0, y: 16 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.45, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                                className="text-center"
                            >
                                <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* Problem / Solution */}
                <section className="section-pad">
                    <div className="container-shell grid gap-6 lg:grid-cols-2">
                        <motion.div
                            {...fadeUp}
                            className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                                <FileWarning className="h-6 w-6" />
                            </div>
                            <h2 className="mt-6 text-2xl font-semibold text-foreground">
                                The problem today
                            </h2>
                            <ul className="mt-6 space-y-4">
                                {problems.map((item) => (
                                    <li key={item} className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                                        <span className="text-sm leading-6 text-muted-foreground">
                                            {item}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </motion.div>

                        <motion.div
                            {...fadeUp}
                            transition={{ ...fadeUp.transition, delay: 0.08 }}
                            className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10"
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10 text-success">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <h2 className="mt-6 text-2xl font-semibold text-foreground">
                                The Acredia solution
                            </h2>
                            <ul className="mt-6 space-y-4">
                                {solutions.map((item) => (
                                    <li key={item} className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                                        <span className="text-sm leading-6 text-muted-foreground">
                                            {item}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    </div>
                </section>

                {/* Architecture */}
                <section className="section-pad bg-muted">
                    <div className="container-shell">
                        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">Technology</span>
                            <h2 className="section-heading mt-3">Built on a modern, open stack</h2>
                            <p className="section-copy mx-auto mt-4 text-center">
                                Acredia combines blockchain, decentralized storage, and smart
                                contracts into one trustworthy experience.
                            </p>
                        </motion.div>
                        <div className="mt-14 grid gap-6 sm:grid-cols-2">
                            {architecture.map((item, i) => (
                                <motion.div
                                    key={item.title}
                                    {...fadeUp}
                                    transition={{ ...fadeUp.transition, delay: (i % 2) * 0.06 }}
                                    className="flex items-start gap-4 rounded-2xl border border-border bg-card p-7 shadow-sm"
                                >
                                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                        <item.icon className="h-6 w-6" />
                                    </span>
                                    <div>
                                        <h3 className="text-lg font-semibold text-foreground">
                                            {item.title}
                                        </h3>
                                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                            {item.description}
                                        </p>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Why Stellar */}
                <section className="section-pad">
                    <div className="container-shell">
                        <motion.div
                            {...fadeUp}
                            className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:grid lg:grid-cols-2"
                        >
                            <div className="bg-brand-mesh p-8 sm:p-12">
                                <span className="badge-gold">
                                    <Zap className="h-3.5 w-3.5" />
                                    Why Stellar
                                </span>
                                <h2 className="mt-6 text-3xl font-bold tracking-tight text-white">
                                    Fast, affordable, and built for global reach
                                </h2>
                                <p className="mt-4 text-white/75">
                                    Stellar makes credential issuance affordable at any scale — with
                                    near-instant settlement, sub-cent fees, and a decentralized
                                    validator network trusted since 2014.
                                </p>
                            </div>
                            <div className="p-8 sm:p-12">
                                <ul className="space-y-5">
                                    {[
                                        'Sub-cent transaction fees for affordable issuance',
                                        'Transaction finality in 3–5 seconds',
                                        'Energy-efficient consensus, no mining',
                                        'Battle-tested, decentralized infrastructure',
                                    ].map((point) => (
                                        <li key={point} className="flex items-start gap-3">
                                            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                                            <span className="text-sm text-muted-foreground">
                                                {point}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </motion.div>
                    </div>
                </section>

                {/* CTA */}
                <section className="pb-20 sm:pb-24">
                    <div className="container-shell">
                        <motion.div
                            {...fadeUp}
                            className="overflow-hidden rounded-3xl bg-brand-mesh px-6 py-16 text-center sm:px-12"
                        >
                            <div className="mx-auto max-w-2xl">
                                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                    Join the future of academic credentials
                                </h2>
                                <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">
                                    Whether you issue, hold, or verify credentials — Acredia makes
                                    trust effortless.
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
