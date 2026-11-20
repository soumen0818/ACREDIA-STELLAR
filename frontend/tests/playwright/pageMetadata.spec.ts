import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * What a search engine or a link preview reads from each public page
 * (review §4.5): one brand in the title, the page's own canonical URL, and a
 * 1200×630 social card.
 */

const PAGES: Array<{ path: string; title: string }> = [
    { path: '/', title: 'Acredia - Blockchain Academic Credentials' },
    { path: '/about', title: 'About | Acredia' },
    { path: '/contact', title: 'Contact | Acredia' },
    { path: '/issuers', title: 'Verified issuers | Acredia' },
    { path: '/verify', title: 'Verify a credential | Acredia' },
    { path: '/solutions/students', title: 'For students | Acredia' },
    { path: '/solutions/institutions', title: 'For institutions | Acredia' },
    { path: '/docs/api', title: 'API documentation | Acredia' },
    { path: '/legal/privacy', title: 'Privacy Policy | Acredia' },
    { path: '/legal/terms', title: 'Terms of Service | Acredia' },
    { path: '/legal/dpa', title: 'Data Processing Agreement | Acredia' },
    { path: '/status', title: 'System status | Acredia' },
    { path: '/auth/login', title: 'Sign in | Acredia' },
    { path: '/claim', title: 'Claim your credentials | Acredia' },
];

/** Pages with a card of their own; the rest use the site-wide card, /opengraph-image. */
const OWN_CARD = new Set(['/about', '/contact', '/issuers', '/verify', '/solutions/students', '/solutions/institutions', '/docs/api']);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function expectSocialCard(request: APIRequestContext, imageUrl: string) {
    const response = await request.get(new URL(imageUrl).pathname + new URL(imageUrl).search);
    expect(response.status(), imageUrl).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(pngSize(await response.body())).toEqual({ width: 1200, height: 630 });
}

for (const { path, title } of PAGES) {
    test(`${path} has its own title, canonical URL and social card`, async ({ page, request }) => {
        await page.goto(path);

        await expect(page).toHaveTitle(title);
        expect(title.match(/Acredia/g)?.length, 'the brand appears once').toBe(1);

        const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
        expect(new URL(canonical as string).pathname.replace(/\/$/, '') || '/').toBe(path);
        const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
        expect(new URL(ogUrl as string).pathname.replace(/\/$/, '') || '/').toBe(path);

        const images = page.locator('meta[property="og:image"]');
        await expect(images).toHaveCount(1);
        await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
        await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
        const imageUrl = (await images.getAttribute('content')) as string;
        const cardPath = OWN_CARD.has(path) ? `${path}/opengraph-image` : '/opengraph-image';
        expect(new URL(imageUrl).pathname).toBe(cardPath);
        await expectSocialCard(request, imageUrl);

        // No X account exists yet, so none is named (lib/contact.ts).
        await expect(page.locator('meta[name="twitter:creator"]')).toHaveCount(0);
        await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    });
}

test('pages outside the public site do not claim the home page as their canonical URL', async ({ page }) => {
    // Before review §4.5 the root layout's canonical ('/') reached every route.
    await page.goto('/auth/forgot-password');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
});
