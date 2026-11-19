import { Metadata } from 'next';
import React from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'About',
    description:
        'Learn how Acredia uses Stellar smart contracts and private document storage to provide secure, tamper-proof academic credentials.',
    path: '/about',
    card: 'own',
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
