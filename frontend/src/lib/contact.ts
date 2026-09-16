/**
 * Single source of truth for Acredia's public contact details.
 *
 * Legal pages, the site footer and support copy all read from here so the
 * address only ever has to change in one place.
 */

/** Primary public inbox — support, privacy, legal and security reports. */
export const CONTACT_EMAIL = 'acredia.stellar@gmail.com';

/** `mailto:` href for the primary inbox. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/**
 * X / Twitter handle — **unset until a real account exists**.
 *
 * This was previously hardcoded to a placeholder handle, which rendered a
 * "Follow us on X" card on the public contact page pointing at an account that
 * does not exist. A dead social link on a product whose entire proposition is
 * trustworthiness is worse than no link at all, so the surface is now opt-in:
 * set the handle here (or via `NEXT_PUBLIC_TWITTER_HANDLE`) and every place
 * that reads `hasTwitter` starts rendering it.
 */
export const TWITTER_HANDLE: string | null =
    process.env.NEXT_PUBLIC_TWITTER_HANDLE?.trim() || null;

export const TWITTER_URL: string | null = TWITTER_HANDLE
    ? `https://x.com/${TWITTER_HANDLE.replace(/^@/, '')}`
    : null;

/** True only when a real handle is configured; gates the social links. */
export const hasTwitter = Boolean(TWITTER_HANDLE && TWITTER_URL);
