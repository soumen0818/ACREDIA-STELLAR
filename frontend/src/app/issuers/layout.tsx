import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

export const metadata: Metadata = pageMetadata({
    title: 'Verified issuers',
    description:
        'Public directory of institutions verified and authorised on the Stellar blockchain to issue tamper-proof academic credentials via Acredia.',
    path: '/issuers',
    card: 'own',
});

export default function IssuersLayout({ children }: { children: ReactNode }) {
    return children;
}
