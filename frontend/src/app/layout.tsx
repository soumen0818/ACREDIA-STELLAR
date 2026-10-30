import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';

import { APP_IDENTITY_META_CONTENT, APP_IDENTITY_META_NAME } from '@/lib/appIdentity';
import { getMetadataBase, getSiteUrl } from '@/lib/siteUrl';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-sans',
});

export const metadata: Metadata = {
    metadataBase: getMetadataBase(),
    title: {
        default: 'Acredia - Blockchain Academic Credentials',
        template: '%s | Acredia',
    },
    description:
        'Secure, tamper-proof academic credentials anchored on the Stellar blockchain.',
    keywords: [
        'academic credentials',
        'blockchain verification',
        'Stellar',
        'verifiable credentials',
        'digital diplomas',
        'NFT degrees',
    ],
    authors: [{ name: 'Acredia Team' }],
    creator: 'Acredia',
    publisher: 'Acredia',
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: 'Acredia - Blockchain Academic Credentials',
        description:
            'Secure, tamper-proof academic credentials anchored on the Stellar blockchain.',
        url: getSiteUrl(),
        siteName: 'Acredia',
        images: [
            {
                url: '/logo.png',
                width: 1200,
                height: 630,
                alt: 'Acredia - Blockchain Academic Credentials',
            },
        ],
        type: 'website',
        locale: 'en_US',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Acredia - Blockchain Academic Credentials',
        description:
            'Secure, tamper-proof academic credentials anchored on the Stellar blockchain.',
        images: ['/logo.png'],
        creator: '@acredia',
    },
    // Favicon/icons are provided by the file-based conventions in this directory
    // (src/app/favicon.ico and src/app/icon.png), so the browser's default
    // `/favicon.ico` request resolves on every route — including error pages.
    other: {
        // Identifies this server as Acredia to the Playwright global setup, so
        // a reused dev server belonging to some other project is rejected
        // instead of silently audited (ACREDIA-STELLAR#271). Emitted from the
        // root layout so it is present on every route, error pages included.
        [APP_IDENTITY_META_NAME]: APP_IDENTITY_META_CONTENT,
    },
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Reading headers() here opts this layout into dynamic rendering, which is
    // what lets Next.js discover the per-request nonce (see src/middleware.ts)
    // and automatically add it to the inline scripts Next.js itself injects for
    // hydration — without this, script-src's 'nonce-...' would block them.
    await headers();

    return (
        <html lang="en" className={inter.variable} suppressHydrationWarning>
            <body className="font-sans antialiased" suppressHydrationWarning>
                <Providers>
                    {children}
                    <Toaster position="top-right" />
                </Providers>
            </body>
        </html>
    );
}
