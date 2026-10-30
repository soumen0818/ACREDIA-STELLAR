import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
    title: 'About Acredia - Blockchain Academic Credentials',
    description: 'Learn how Acredia uses Stellar smart contracts and private document storage to provide secure, tamper-proof academic credentials.',
    openGraph: {
        title: 'About Acredia - Blockchain Academic Credentials',
        description: 'Learn how Acredia uses Stellar smart contracts and private document storage to provide secure, tamper-proof academic credentials.',
        images: ['/logo.png'],
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'About Acredia - Blockchain Academic Credentials',
        description: 'Learn how Acredia uses Stellar smart contracts and private document storage to provide secure, tamper-proof academic credentials.',
        images: ['/logo.png'],
    },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
