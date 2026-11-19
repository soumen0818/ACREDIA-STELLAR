import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Page titles, canonical URLs and social tags (review §4.5). Each public page
 * sets its own: Next.js passes metadata down to child routes, so values left
 * to the root layout made every page claim to be the home page.
 */

async function load(twitterHandle?: string) {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_TWITTER_HANDLE', twitterHandle ?? '');
    return import('../src/lib/pageMetadata');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('pageMetadata', () => {
    it('gives the page its own title, canonical URL and og:url', async () => {
        const { pageMetadata } = await load();
        const meta = pageMetadata({ title: 'About', description: 'What we do.', path: '/about', card: 'own' });

        // The root template adds " | Acredia" to the document title.
        expect(meta.title).toBe('About');
        expect(meta.alternates?.canonical).toBe('/about');
        expect(meta.openGraph).toMatchObject({
            title: 'About | Acredia',
            description: 'What we do.',
            url: '/about',
            siteName: 'Acredia',
            type: 'website',
        });
        expect(meta.twitter).toMatchObject({
            card: 'summary_large_image',
            title: 'About | Acredia',
            description: 'What we do.',
        });
    });

    it('uses an absolute title as is, for the home page', async () => {
        const { pageMetadata, SITE_TITLE } = await load();
        const meta = pageMetadata({ title: { absolute: SITE_TITLE }, description: 'x', path: '/', card: 'own' });

        expect(meta.title).toEqual({ absolute: SITE_TITLE });
        expect(meta.openGraph?.title).toBe(SITE_TITLE);
    });

    it('leaves the image to a route that has its own card', async () => {
        const { pageMetadata } = await load();
        const meta = pageMetadata({ title: 'About', description: 'x', path: '/about', card: 'own' });

        // A page's metadata outranks a card file in its own folder.
        expect(meta.openGraph).not.toHaveProperty('images');
    });

    it('names the site-wide 1200×630 card for a route without one', async () => {
        const { pageMetadata } = await load();
        const meta = pageMetadata({ title: 'Privacy Policy', description: 'x', path: '/legal/privacy', card: 'site' });

        expect(meta.openGraph?.images).toEqual([
            {
                url: '/opengraph-image',
                width: 1200,
                height: 630,
                alt: 'Acredia: Tamper-proof credentials, verifiable by anyone.',
            },
        ]);
    });
});

describe('X account in the social tags', () => {
    it('is omitted while no account is configured', async () => {
        const { pageMetadata, twitterAccount } = await load();

        expect(twitterAccount()).toEqual({});
        expect(pageMetadata({ title: 'A', description: 'x', path: '/a', card: 'site' }).twitter).not.toHaveProperty(
            'creator',
        );
    });

    it('comes from NEXT_PUBLIC_TWITTER_HANDLE, with or without the @', async () => {
        for (const handle of ['acredia_hq', '@acredia_hq']) {
            const { pageMetadata } = await load(handle);
            expect(pageMetadata({ title: 'A', description: 'x', path: '/a', card: 'site' }).twitter).toMatchObject({
                site: '@acredia_hq',
                creator: '@acredia_hq',
            });
        }
    });
});

describe('card declarations', () => {
    const APP = join(process.cwd(), 'src', 'app');
    const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return files(path);
            return /\.tsx?$/.test(name) ? [path] : [];
        });
    const declarations = files(APP).flatMap((file) => {
        const card = readFileSync(file, 'utf8').match(/pageMetadata\(\{[\s\S]*?card: '(own|site)'/)?.[1];
        return card ? [{ file: relative(APP, file), dir: dirname(file), card }] : [];
    });

    it('finds the public pages', () => {
        expect(declarations.length).toBeGreaterThanOrEqual(13);
    });

    it("match the files: 'own' beside an opengraph-image.tsx, 'site' without one", () => {
        for (const { file, dir, card } of declarations) {
            expect(existsSync(join(dir, 'opengraph-image.tsx')), `${file} declares card: '${card}'`).toBe(card === 'own');
        }
    });
});
