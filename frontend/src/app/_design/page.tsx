'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const tokens = [
    { name: 'Spacing', value: '4 / 6 / 8 / 12' },
    { name: 'Typography', value: 'text-3xl / text-base / text-muted-foreground' },
    { name: 'Buttons', value: 'brand, surface, outline' },
];

export default function DesignReferencePage() {
    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="container-shell section-stack py-12 sm:py-16">
                <div className="space-y-4">
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
                        Design system
                    </p>
                    <h1 className="section-heading">Acredia UI tokens</h1>
                    <p className="section-copy">
                        Shared spacing, typography, and surface styles keep the product coherent
                        across authentication, dashboards, and marketing pages.
                    </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                    {tokens.map((token) => (
                        <Card key={token.name} className="bg-card/80">
                            <CardHeader>
                                <CardTitle>{token.name}</CardTitle>
                                <CardDescription>{token.value}</CardDescription>
                            </CardHeader>
                        </Card>
                    ))}
                </div>

                <Card className="bg-card/80">
                    <CardHeader>
                        <CardTitle>Component examples</CardTitle>
                        <CardDescription>
                            Buttons and cards inherit semantic theme tokens so dark mode stays
                            consistent.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-3">
                        <Button variant="brand">Primary action</Button>
                        <Button variant="surface">Surface action</Button>
                        <Button variant="outline">Outline action</Button>
                        <Button variant="ghost">Ghost action</Button>
                    </CardContent>
                </Card>

                <div className="flex flex-wrap gap-3">
                    <Button asChild variant="brand">
                        <Link href="/">Back home</Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/about">About</Link>
                    </Button>
                </div>
            </div>
        </main>
    );
}
