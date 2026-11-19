import { describe, expect, it } from 'vitest';
import { budgetFor, overBudget, routeFromManifest } from '../scripts/check-bundle-budget.mjs';

/**
 * scripts/check-bundle-budget.mjs runs after `next build` in CI and fails if a
 * page's initial client JS, gzipped, exceeds its group's budget (review §4.1).
 */

const KB = 1024;

describe('routeFromManifest', () => {
    it('maps a manifest path to the URL route, without route groups', () => {
        expect(routeFromManifest('page_client-reference-manifest.js')).toBe('/');
        expect(routeFromManifest('legal/privacy/page_client-reference-manifest.js')).toBe('/legal/privacy');
        expect(routeFromManifest('(console)/dashboard/issue/page_client-reference-manifest.js')).toBe('/dashboard/issue');
        expect(routeFromManifest('credentials/[token]/page_client-reference-manifest.js')).toBe('/credentials/[token]');
    });
});

describe('budgetFor', () => {
    it.each([
        ['/', 'public', 115],
        ['/legal/privacy', 'public', 115],
        ['/verify', 'public', 115],
        ['/credentials/[token]', 'share page', 155],
        ['/auth/login', 'sign-in and claim', 180],
        ['/claim', 'sign-in and claim', 180],
        ['/dashboard', 'console', 360],
        ['/admin/authorize', 'console', 360],
    ])('%s is in the %s group (%i KB)', (route, group, maxGzipKb) => {
        expect(budgetFor(route)).toMatchObject({ group, maxGzipKb });
    });

    it('does not mistake a public page for a console one by prefix alone', () => {
        expect(budgetFor('/dashboards-overview')?.group).toBe('public');
        expect(budgetFor('/authors')?.group).toBe('public');
    });
});

describe('overBudget', () => {
    it('reports only pages above their own group’s budget', () => {
        const pages = [
            { route: '/', rawBytes: 0, gzipBytes: 115 * KB },
            { route: '/about', rawBytes: 0, gzipBytes: 115 * KB + 1 },
            { route: '/dashboard/issue', rawBytes: 0, gzipBytes: 300 * KB },
        ];
        expect(overBudget(pages).map((page: { route: string }) => page.route)).toEqual(['/about']);
    });
});
