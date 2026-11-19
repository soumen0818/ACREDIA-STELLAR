import { Metadata } from 'next';
import React from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'For institutions',
    description:
        'Enable your institution to issue tamper-proof, blockchain-verified academic credentials with ease.',
    path: '/solutions/institutions',
    card: 'own',
});

export default function InstitutionsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
