#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// check-dynamic-pages.mjs
// ──────────────────────────────────────────────────────────────────────────────
// Usage (after `next build`):
//   node scripts/check-dynamic-pages.mjs
//
// Fails if the build prerendered any page. Every page must be rendered per
// request so that it carries the CSP nonce from src/proxy.ts: a static page's
// HTML has no nonce, so under the policy its scripts are blocked and it never
// hydrates (docs/decisions/0007-csp-nonce-on-every-page.md). The dev server
// renders everything per request, so only the production build shows this.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Prerendered routes that are files, not pages: they run no scripts. */
const FILE_ROUTE = /\.(?:ico|png|svg|webmanifest|txt|xml|js)$/;

/**
 * Prerendered pages that are known and accepted. `/_global-error` is Next.js's
 * page for a crash in the root layout itself, and is always prerendered; its
 * text shows, but its "Try again" button cannot run under the policy (ADR 0007,
 * follow-up).
 */
const ACCEPTED_STATIC_PAGES = new Set(['/_global-error']);

/** The prerendered routes in `manifest` that are pages and not accepted. */
export function findStaticPages(manifest) {
    return [...Object.keys(manifest.routes ?? {}), ...Object.keys(manifest.dynamicRoutes ?? {})].filter(
        (route) => !FILE_ROUTE.test(route) && !ACCEPTED_STATIC_PAGES.has(route),
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const manifestPath = join(process.cwd(), '.next', 'prerender-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const staticPages = findStaticPages(manifest);

    if (staticPages.length > 0) {
        console.error('These pages were prerendered, so their HTML has no CSP nonce and their scripts will be blocked:');
        for (const route of staticPages) console.error(`  ${route}`);
        console.error('Keep them dynamic (see docs/decisions/0007-csp-nonce-on-every-page.md).');
        process.exit(1);
    }
    console.log(`OK: no page is prerendered (${Object.keys(manifest.routes ?? {}).length} prerendered file routes).`);
}
