import { describe, expect, it } from 'vitest';
import { findStaticPages } from '../scripts/check-dynamic-pages.mjs';

/**
 * scripts/check-dynamic-pages.mjs runs after `next build` in CI and fails if
 * any page was prerendered, since a static page cannot carry the CSP nonce
 * (docs/decisions/0007-csp-nonce-on-every-page.md).
 */

/** A prerendered file route, as the build records it: with its content type. */
const file = (type: string) => ({ initialHeaders: { 'content-type': type } });
/** A prerendered page: the build records no content type for it. */
const page = () => ({ initialHeaders: {} });

describe('findStaticPages', () => {
    it('accepts a build that prerendered only files and the global error page', () => {
        expect(
            findStaticPages({
                routes: {
                    '/_global-error': {},
                    '/favicon.ico': file('image/x-icon'),
                    '/icon.png': file('image/png'),
                    '/manifest.webmanifest': file('application/manifest+json'),
                    '/robots.txt': file('text/plain'),
                    '/sitemap.xml': file('application/xml'),
                    '/widget.js': file('text/javascript; charset=utf-8'),
                    // Generated social cards: files, though their paths have no extension.
                    '/opengraph-image': file('image/png'),
                    '/about/opengraph-image': file('image/png'),
                },
                dynamicRoutes: {},
            }),
        ).toEqual([]);
    });

    it('reports a prerendered page', () => {
        expect(
            findStaticPages({
                routes: { '/robots.txt': file('text/plain'), '/': page(), '/legal/privacy': {} },
                dynamicRoutes: {},
            }),
        ).toEqual(['/', '/legal/privacy']);
    });

    it('reports a page served as HTML even if its path looks like a file', () => {
        expect(findStaticPages({ routes: { '/report.png': file('text/html; charset=utf-8') }, dynamicRoutes: {} })).toEqual([
            '/report.png',
        ]);
    });

    it('reports a page prerendered for its params', () => {
        expect(findStaticPages({ routes: {}, dynamicRoutes: { '/credentials/[token]': page() } })).toEqual([
            '/credentials/[token]',
        ]);
    });

    it('does not accept the not-found page silently', () => {
        expect(findStaticPages({ routes: { '/_not-found': page() }, dynamicRoutes: {} })).toEqual(['/_not-found']);
    });
});
