import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Verified Issuer Registry — Acredia',
    description:
        'Public directory of institutions verified and authorised on the Stellar blockchain to issue tamper-proof academic credentials via Acredia.',
};

export default function IssuersLayout({ children }: { children: ReactNode }) {
    return children;
}
