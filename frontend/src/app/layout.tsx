import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

import { APP_IDENTITY_META_CONTENT, APP_IDENTITY_META_NAME } from '@/lib/appIdentity';
import { getMetadataBase } from '@/lib/siteUrl';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, twitterAccount } from '@/lib/pageMetadata';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-sans',
});

export const metadata: Metadata = {
    metadataBase: getMetadataBase(),
    title: {
        default: SITE_TITLE,
        template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: [
        'academic credentials',
        'blockchain verification',
        'Stellar',
        'verifiable credentials',
        'digital diplomas',
        'NFT degrees',
    ],
    authors: [{ name: 'Acredia Team' }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    // No canonical URL or og:url here: Next.js passes these down to every
    // route, so a value here told search engines that each page was a copy of
    // the home page. Public pages set their own with pageMetadata() (review
    // §4.5). The card image is app/opengraph-image.tsx.
    openGraph: {
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        siteName: SITE_NAME,
        type: 'website',
        locale: 'en_US',
    },
    twitter: {
        card: 'summary_large_image',
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        ...twitterAccount(),
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
    // what lets Next.js discover the per-request nonce (see src/proxy.ts)
    // and automatically add it to the inline scripts Next.js itself injects for
    // hydration — without this, script-src's 'nonce-...' would block them.
    // Every page depends on it, static marketing pages included: see
    // docs/decisions/0007-csp-nonce-on-every-page.md. CI checks the build for
    // prerendered pages (scripts/check-dynamic-pages.mjs).
    await headers();

    return (
        <html lang="en" className={inter.variable} suppressHydrationWarning>
            <body className="font-sans antialiased" suppressHydrationWarning>
                {/* No app-wide providers: the session and wallet are mounted by
                    app/(console)/layout.tsx and app/claim/layout.tsx only, so
                    public pages ship without them (review §4.1). */}
                {children}
                <Toaster position="top-right" />
            </body>
        </html>
    );
}
