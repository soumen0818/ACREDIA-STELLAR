import { describe, expect, it } from 'vitest';
import { findStaticPages } from '../scripts/check-dynamic-pages.mjs';

/**
 * scripts/check-dynamic-pages.mjs runs after `next build` in CI and fails if
 * any page was prerendered, since a static page cannot carry the CSP nonce
 * (docs/decisions/0007-csp-nonce-on-every-page.md).
 */

const routes = (...paths: string[]) => Object.fromEntries(paths.map((path) => [path, {}]));

describe('findStaticPages', () => {
    it('accepts a build that prerendered only files and the global error page', () => {
        expect(
            findStaticPages({
                routes: routes(
                    '/_global-error',
                    '/favicon.ico',
                    '/icon.png',
                    '/manifest.webmanifest',
                    '/robots.txt',
                    '/sitemap.xml',
                    '/widget/v1.js',
                    '/widget.js',
                ),
                dynamicRoutes: {},
            }),
        ).toEqual([]);
    });

    it('reports a prerendered page', () => {
        expect(findStaticPages({ routes: routes('/robots.txt', '/', '/legal/privacy'), dynamicRoutes: {} })).toEqual([
            '/',
            '/legal/privacy',
        ]);
    });

    it('reports a page prerendered for its params', () => {
        expect(findStaticPages({ routes: {}, dynamicRoutes: routes('/credentials/[token]') })).toEqual([
            '/credentials/[token]',
        ]);
    });

    it('does not accept the not-found page silently', () => {
        expect(findStaticPages({ routes: routes('/_not-found'), dynamicRoutes: {} })).toEqual(['/_not-found']);
    });
});
