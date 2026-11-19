import type { Metadata } from 'next';
import { TWITTER_HANDLE } from './contact';
import { cardAlt, OG_SIZE, SITE_CARD } from './og/cards';

/** The brand the root layout's title template appends (`%s | Acredia`). */
export const SITE_NAME = 'Acredia';

/** The home page's title, and every page's fallback title. */
export const SITE_TITLE = 'Acredia - Blockchain Academic Credentials';

export const SITE_DESCRIPTION = 'Secure, tamper-proof academic credentials anchored on the Stellar blockchain.';

/**
 * `twitter:site` / `twitter:creator`, only when a real X account is
 * configured (`NEXT_PUBLIC_TWITTER_HANDLE`, lib/contact.ts). It used to be a
 * hardcoded '@acredia', an account that does not exist (review §4.5).
 */
export function twitterAccount(): { site: string; creator: string } | Record<string, never> {
    if (!TWITTER_HANDLE) return {};
    const handle = `@${TWITTER_HANDLE.replace(/^@/, '')}`;
    return { site: handle, creator: handle };
}

interface PageMetadataInput {
    /**
     * The page's own name, without the brand: the root layout's template adds
     * " | Acredia" (review §4.5). `{ absolute }` skips the template.
     */
    title: string | { absolute: string };
    description: string;
    /** The page's path, e.g. `/about`. Used as its canonical URL and og:url. */
    path: string;
    /**
     * `'own'` if the route has an `opengraph-image.tsx` of its own, `'site'`
     * to use the site-wide card. Required: a page's metadata outranks a card
     * file in its own folder, so naming the site card there would hide the
     * route's card.
     */
    card: 'own' | 'site';
}

/**
 * Metadata for a public, indexable page: its title, its own canonical URL,
 * and its social-card text.
 *
 * Next.js passes metadata down to child routes, and replaces a nested object
 * such as `openGraph` whole rather than merging it. So each page sets all of
 * this itself: a canonical or og:url left to the root layout pointed every
 * page at the home page (review §4.5).
 *
 * A page without a card of its own names the site-wide one
 * (app/opengraph-image.tsx) here, because its `openGraph` replaces the
 * inherited one, image included.
 */
export function pageMetadata({ title, description, path, card }: PageMetadataInput): Metadata {
    const socialTitle = typeof title === 'string' ? `${title} | ${SITE_NAME}` : title.absolute;

    return {
        title,
        description,
        alternates: { canonical: path },
        openGraph: {
            title: socialTitle,
            description,
            url: path,
            siteName: SITE_NAME,
            type: 'website',
            locale: 'en_US',
            ...(card === 'site' && { images: [{ url: '/opengraph-image', ...OG_SIZE, alt: cardAlt(SITE_CARD) }] }),
        },
        twitter: {
            card: 'summary_large_image',
            title: socialTitle,
            description,
            ...twitterAccount(),
        },
    };
}
