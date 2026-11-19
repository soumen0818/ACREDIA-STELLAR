import { Metadata } from 'next';
import React from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'Verify a credential',
    description:
        'Instantly verify the cryptographic authenticity and on-chain status of academic credentials issued on the Stellar blockchain.',
    path: '/verify',
    card: 'own',
});

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
