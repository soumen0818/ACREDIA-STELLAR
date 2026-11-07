import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('Route Loading and Error Boundaries', () => {
    const appDir = join(process.cwd(), 'src', 'app');

    // The lists below are URL routes. A route group such as `(console)` holds
    // segments without adding to the URL, so look inside each group too.
    const routeGroups = readdirSync(appDir).filter((name) => /^\(.+\)$/.test(name));
    const segmentDir = (route: string) => {
        const inGroup = routeGroups.map((group) => join(appDir, group, route)).find((dir) => existsSync(dir));
        return inGroup ?? join(appDir, route);
    };

    const expectedDataFetchingRoutes = [
        'credentials/[token]',
        'admin/institutions',
        'admin/institutions/[id]',
        'admin/authorize',
        'admin/settings',
        'dashboard/credentials',
        'dashboard/settings',
        'contact',
        'issuers',
        'docs/api',
        'verify',
    ];

    const expectedErrorBoundaries = [
        'credentials/[token]',
        'admin/institutions',
        'admin/institutions/[id]',
        'admin/authorize',
        'admin/settings',
        'dashboard/credentials',
        'dashboard/settings',
        'auth',
        'contact',
        'issuers',
        'docs/api',
        'about',
        'legal',
        'solutions',
        'verify',
        'admin',
        'dashboard',
    ];

    it('provides layout-matched loading.tsx for all data-fetching and public routes', () => {
        for (const route of expectedDataFetchingRoutes) {
            const loadingPath = join(segmentDir(route), 'loading.tsx');
            expect(
                existsSync(loadingPath),
                `Missing loading.tsx for route: ${route}`,
            ).toBe(true);
        }
    });

    it('provides localized error.tsx boundaries with retry for all key route segments', () => {
        for (const route of expectedErrorBoundaries) {
            const errorPath = join(segmentDir(route), 'error.tsx');
            expect(
                existsSync(errorPath),
                `Missing error.tsx for route: ${route}`,
            ).toBe(true);
        }
    });
});
