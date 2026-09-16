/**
 * Resolves the canonical base URL for metadata, Open Graph previews, sitemaps, and robots.
 *
 * Evaluation order:
 * 1. NEXT_PUBLIC_SITE_URL (configured production domain)
 * 2. VERCEL_URL (automatically provided by Vercel deployment environments)
 * 3. https://acredia.example (RFC 2606 reserved placeholder — deliberately
 *    non-resolving)
 *
 * The final fallback is reserved-by-standard rather than a plausible-looking
 * domain on purpose. Invite links, password resets, and credential
 * notifications are all built from this value, and Acredia accounts cannot be
 * self-registered — so a misconfigured deployment that silently produced
 * links to a *real-looking* domain would lock users out with no clue why.
 * A `.example` host fails visibly and points straight at the missing variable.
 *
 * Set `NEXT_PUBLIC_SITE_URL` in production. On Vercel, `VERCEL_URL` covers
 * preview deployments automatically.
 */
export function getSiteUrl(): string {
    const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (envUrl && envUrl.trim()) {
        const trimmed = envUrl.trim();
        return trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : `https://${trimmed}`;
    }

    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl && vercelUrl.trim()) {
        return `https://${vercelUrl.trim()}`;
    }

    return 'https://acredia.example';
}

/**
 * Returns a valid URL object for Next.js Metadata `metadataBase`.
 *
 * Ensures relative social media OpenGraph and Twitter image URLs (e.g. '/logo.png')
 * resolve to absolute, publicly fetchable URLs across all deployment environments.
 */
export function getMetadataBase(): URL {
    try {
        return new URL(getSiteUrl());
    } catch {
        return new URL('https://acredia.example');
    }
}
