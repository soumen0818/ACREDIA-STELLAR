/**
 * The text and size of the social cards, kept apart from brandCard.tsx so
 * that metadata code can name a card without loading the image renderer.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

export interface BrandCardText {
    /** Short label above the title, e.g. "For institutions". */
    eyebrow: string;
    title: string;
    description: string;
}

/**
 * The site-wide card, app/opengraph-image.tsx. Pages without a card of their
 * own (the legal pages, sign-in, claim) use it too: lib/pageMetadata.ts.
 */
export const SITE_CARD: BrandCardText = {
    eyebrow: 'Academic credentials',
    title: 'Tamper-proof credentials, verifiable by anyone.',
    description: 'Institutions issue on Stellar, students own them for life, and anyone can verify in seconds.',
};

/** The alt text of a card, as each route's opengraph-image exports it. */
export function cardAlt(card: BrandCardText): string {
    return `Acredia: ${card.title}`;
}
