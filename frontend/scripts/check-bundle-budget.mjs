#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// check-bundle-budget.mjs
// ──────────────────────────────────────────────────────────────────────────────
// Usage (after `next build`):
//   node scripts/check-bundle-budget.mjs
//
// Fails if a page's initial client JavaScript, gzipped, exceeds its budget
// (review §4.1). A page's initial JS is every script its client-reference
// manifest lists as an entry; code loaded later with `import()` or
// `next/dynamic` (the wallet kit, the QR scanner, the charts) is not counted.
//
// Budgets are gzipped bytes, what a visitor downloads. Raw sizes are printed
// too. The review's "under 200 KB" target cannot be met in raw bytes: Next.js
// and React alone are about 206 KB on every page (measured 2026-11-19 with
// `next analyze`).
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;

/**
 * Budgets in gzipped KB, first matching group wins. Set at the sizes of
 * 2026-11-19 plus about 10%; lower them when a page gets lighter.
 */
export const BUDGETS = [
    { group: 'console', match: (route) => /^\/(dashboard|admin)(\/|$)/.test(route), maxGzipKb: 360 },
    { group: 'share page', match: (route) => route.startsWith('/credentials/'), maxGzipKb: 155 },
    { group: 'sign-in and claim', match: (route) => /^\/(auth|claim)(\/|$)/.test(route), maxGzipKb: 180 },
    { group: 'public', match: () => true, maxGzipKb: 115 },
];

export function budgetFor(route) {
    return BUDGETS.find((budget) => budget.match(route));
}

/**
 * The URL route of a page's client-reference manifest, relative to
 * `.next/server/app`: route groups such as `(console)` are not in the URL.
 */
export function routeFromManifest(relativePath) {
    const segments = relativePath.split(/[\\/]/).slice(0, -1).filter((segment) => !/^\(.+\)$/.test(segment));
    return `/${segments.join('/')}`;
}

/** Pages whose initial JS exceeds their group's budget. */
export function overBudget(pages) {
    return pages.filter((page) => page.gzipBytes > budgetFor(page.route).maxGzipKb * KB);
}

function manifests(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return manifests(path);
        return name === 'page_client-reference-manifest.js' ? [path] : [];
    });
}

/** The initial client JS of every page in a build: route, raw and gzipped bytes. */
export function measureBuild(nextDir) {
    const appDir = join(nextDir, 'server', 'app');
    return manifests(appDir)
        .map((manifestPath) => {
            globalThis.__RSC_MANIFEST = {};
            new Function(readFileSync(manifestPath, 'utf8'))();
            const manifest = Object.values(globalThis.__RSC_MANIFEST)[0];
            const files = [...new Set(Object.values(manifest.entryJSFiles).flat())].filter((file) => file.endsWith('.js'));
            let rawBytes = 0;
            let gzipBytes = 0;
            for (const file of files) {
                const content = readFileSync(join(nextDir, file));
                rawBytes += content.length;
                gzipBytes += gzipSync(content).length;
            }
            return { route: routeFromManifest(relative(appDir, manifestPath).split(sep).join('/')), rawBytes, gzipBytes };
        })
        .filter((page) => !page.route.startsWith('/_'))
        .sort((a, b) => a.route.localeCompare(b.route));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const nextDir = join(process.cwd(), '.next');
    if (!existsSync(join(nextDir, 'server', 'app'))) {
        console.error('No build found. Run `next build` first.');
        process.exit(1);
    }

    const pages = measureBuild(nextDir);
    const failures = new Set(overBudget(pages));
    for (const page of pages) {
        const budget = budgetFor(page.route);
        const line =
            `${failures.has(page) ? 'OVER' : 'ok  '}  ${page.route.padEnd(40)}` +
            `${(page.gzipBytes / KB).toFixed(0).padStart(5)} KB gzip / ${String(budget.maxGzipKb).padStart(3)} KB` +
            `  (${(page.rawBytes / KB).toFixed(0)} KB raw, ${budget.group})`;
        console.log(line);
    }

    if (failures.size > 0) {
        console.error(`\n${failures.size} page(s) over budget. Load the new code on demand (next/dynamic, import()) ` +
            'or, if the growth is intended, raise the budget in scripts/check-bundle-budget.mjs with the reason.');
        process.exit(1);
    }
    console.log(`\nOK: ${pages.length} pages within budget.`);
}
