import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import manifest from '../src/app/manifest';

describe('SEO & PWA assets', () => {
    it('robots.ts returns correct rules and sitemap link', () => {
        const config = robots();
        expect(config.rules).toBeDefined();
        expect(config.sitemap).toBeDefined();
        expect(config.rules).toMatchObject({
            userAgent: '*',
            allow: '/',
            disallow: ['/admin/', '/dashboard/'],
        });
    });

    it('sitemap.ts lists every public page, and nothing private (review §4.5)', () => {
        const paths = sitemap().map((u) => u.url.replace('https://acredia.example', '') || '/');
        expect(paths.sort()).toEqual(
            [
                '/',
                '/about',
                '/contact',
                '/docs/api',
                '/issuers',
                '/legal/dpa',
                '/legal/privacy',
                '/legal/terms',
                '/solutions/institutions',
                '/solutions/students',
                '/status',
                '/verify',
            ].sort(),
        );
    });

    it('sitemap.ts points only at pages that exist', () => {
        for (const { url } of sitemap()) {
            const route = url.replace('https://acredia.example', '');
            const page = path.join(process.cwd(), 'src', 'app', route, 'page.tsx');
            expect(existsSync(page), `${route || '/'} has no page.tsx`).toBe(true);
        }
    });

    it('manifest.ts returns web manifest metadata', () => {
        const config = manifest();
        expect(config.name).toBe('Acredia Academic Credentials');
        expect(config.short_name).toBe('Acredia');
        expect(config.icons).toBeDefined();
        expect(config.icons?.length).toBeGreaterThan(0);
    });
});

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The file a manifest icon URL is served from: `public/` for static files,
 * or `src/app/` for Next's root-level metadata files such as favicon.ico.
 */
function resolveIconFile(src: string): string | null {
    const relative = src.split('?')[0].replace(/^\//, '');
    for (const dir of ['public', 'src/app']) {
        const candidate = path.join(FRONTEND_ROOT, dir, relative);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Real pixel sizes of an image, from its header alone: the IHDR chunk of a PNG,
 * or every directory entry of an ICO (where a stored 0 means 256).
 */
function readImageSizes(file: string): { type: string; sizes: string[] } {
    const bytes = readFileSync(file);

    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
        return {
            type: 'image/png',
            sizes: [`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`],
        };
    }

    if (bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
        const count = bytes.readUInt16LE(4);
        const sizes = Array.from({ length: count }, (_, index) => {
            const entry = 6 + index * 16;
            return `${bytes[entry] || 256}x${bytes[entry + 1] || 256}`;
        });
        return { type: 'image/x-icon', sizes };
    }

    throw new Error(`${file} is neither a PNG nor an ICO`);
}

describe('manifest icons (ACREDIA-STELLAR#303)', () => {
    const icons = manifest().icons ?? [];

    it.each(icons.map((icon) => [icon.src, icon] as const))(
        '%s resolves to a file whose real dimensions match its declared sizes',
        (src, icon) => {
            const file = resolveIconFile(src);
            expect(file, `${src} does not resolve to a file in public/ or src/app/`).not.toBeNull();

            const actual = readImageSizes(file as string);
            expect(actual.type).toBe(icon.type);

            const declared = (icon.sizes ?? '').split(/\s+/).filter(Boolean);
            expect(declared.length, `${src} declares no sizes`).toBeGreaterThan(0);
            // `any` is only truthful for scalable formats; every raster size
            // must exist in the file exactly as declared.
            expect(declared).not.toContain('any');
            expect([...declared].sort()).toEqual([...actual.sizes].sort());
        },
    );

    it('offers the 192px and 512px icons Chrome requires for installability', () => {
        const anyPurpose = icons.filter((icon) => (icon.purpose ?? 'any').split(' ').includes('any'));
        const anySizes = anyPurpose.flatMap((icon) => (icon.sizes ?? '').split(/\s+/));

        expect(anySizes).toContain('192x192');
        expect(anySizes).toContain('512x512');
    });

    it('offers a 512px maskable icon so Android does not crop the logo', () => {
        const maskable = icons.filter((icon) => icon.purpose?.split(' ').includes('maskable'));

        expect(maskable.map((icon) => icon.sizes)).toContain('512x512');
    });

    it('never points two entries at the same file', () => {
        const sources = icons.map((icon) => icon.src);
        expect(new Set(sources).size).toBe(sources.length);
    });
});
