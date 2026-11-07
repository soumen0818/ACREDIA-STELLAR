import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { revealDelay } from '@/components/marketing/reveal';

interface Item {
    icon: LucideIcon;
    title: string;
    description: string;
}

export interface SolutionPageProps {
    eyebrow: string;
    eyebrowIcon: LucideIcon;
    title: string;
    titleHighlight: string;
    description: string;
    primaryCta: { label: string; href: string };
    features: Item[];
    steps: { title: string; description: string }[];
    benefits: Item[];
    ctaTitle: string;
    ctaDescription: string;
}

export function SolutionPage({
    eyebrow,
    eyebrowIcon: EyebrowIcon,
    title,
    titleHighlight,
    description,
    primaryCta,
    features,
    steps,
    benefits,
    ctaTitle,
    ctaDescription,
}: SolutionPageProps) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <SiteNavbar />

            <main>
                {/* Hero */}
                <section className="bg-app-wash">
                    <div className="container-shell py-16 text-center sm:py-24">
                        <div className="mx-auto max-w-3xl">
                            <span className="badge-gold">
                                <EyebrowIcon className="h-3.5 w-3.5" />
                                {eyebrow}
                            </span>
                            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                                {title}{' '}
                                <span className="text-gradient-gold">{titleHighlight}</span>
                            </h1>
                            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
                                {description}
                            </p>
                            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                                <Button asChild size="xl">
                                    <Link href={primaryCta.href}>
                                        {primaryCta.label}
                                        <ArrowRight className="h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button asChild size="xl" variant="outline">
                                    <Link href="/auth/login">Sign in to dashboard</Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Features */}
                <section className="section-pad">
                    <div className="container-shell">
                        <div className="reveal mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">Capabilities</span>
                            <h2 className="section-heading mt-3">Everything you need</h2>
                        </div>
                        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {features.map((feature, i) => (
                                <div
                                    key={feature.title}
                                    className="reveal group rounded-2xl border border-border bg-card p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
                                    style={revealDelay(i % 3)}
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
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* How it works */}
                <section className="section-pad bg-secondary/40">
                    <div className="container-shell">
                        <div className="reveal mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">How it works</span>
                            <h2 className="section-heading mt-3">Get started in three steps</h2>
                        </div>
                        <div className="mt-14 grid gap-6 md:grid-cols-3">
                            {steps.map((step, i) => (
                                <div
                                    key={step.title}
                                    className="reveal relative rounded-2xl border border-border bg-card p-7 shadow-sm"
                                    style={revealDelay(i)}
                                >
                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                                        {i + 1}
                                    </span>
                                    <h3 className="mt-5 text-lg font-semibold text-foreground">
                                        {step.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        {step.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Benefits */}
                <section className="section-pad">
                    <div className="container-shell">
                        <div className="reveal mx-auto max-w-2xl text-center">
                            <span className="eyebrow justify-center">Benefits</span>
                            <h2 className="section-heading mt-3">Why Acredia</h2>
                        </div>
                        <div className="mt-14 grid gap-6 sm:grid-cols-2">
                            {benefits.map((benefit, i) => (
                                <div
                                    key={benefit.title}
                                    className="reveal flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
                                    style={revealDelay(i % 2)}
                                >
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/12 text-gold">
                                        <benefit.icon className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <h3 className="text-base font-semibold text-foreground">
                                            {benefit.title}
                                        </h3>
                                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                            {benefit.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* CTA */}
                <section className="pb-20 sm:pb-24">
                    <div className="container-shell">
                        <div className="reveal overflow-hidden rounded-3xl bg-brand-mesh px-6 py-16 text-center sm:px-12">
                            <div className="mx-auto max-w-2xl">
                                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                    {ctaTitle}
                                </h2>
                                <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">
                                    {ctaDescription}
                                </p>
                                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                                    <Button asChild size="xl" variant="gold">
                                        <Link href={primaryCta.href}>
                                            {primaryCta.label}
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
                        </div>
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    );
}
