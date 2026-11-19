import { Metadata } from 'next';
import React from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'For students',
    description:
        'Own your academic records forever. Secure, shareable, and verifiable credentials on the Stellar blockchain.',
    path: '/solutions/students',
    card: 'own',
});

export default function StudentsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
