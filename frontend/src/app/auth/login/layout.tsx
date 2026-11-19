import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/pageMetadata';

// The page is a client component, so its title is set here.
export const metadata: Metadata = pageMetadata({
    title: 'Sign in',
    description: 'Sign in to Acredia to issue credentials as an institution or to view and share your own.',
    path: '/auth/login',
    card: 'site',
});

export default function LoginLayout({ children }: { children: ReactNode }) {
    return children;
}
