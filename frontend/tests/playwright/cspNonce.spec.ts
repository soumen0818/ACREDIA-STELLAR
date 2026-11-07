import { expect, test, type Page } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

/**
 * Every page carries the strict, nonce-based CSP, and works under it
 * (docs/decisions/0007-csp-nonce-on-every-page.md). Next.js emits inline
 * scripts on every page; each must carry the nonce of the response's policy,
 * or the browser blocks it and the page never hydrates.
 */

const adminWallet = 'GAcrediaAdminWallet00000000000000000000000000000001';

/** Records CSP violations the page reports, from before any of its scripts run. */
async function recordCspViolations(page: Page) {
    await page.addInitScript(() => {
        const violations: string[] = [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
        document.addEventListener('securitypolicyviolation', (event) => {
            violations.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
        });
    });
}

function cspViolations(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** Opens `path` and checks the server HTML against the response's policy. */
async function expectNonceOnEveryScript(page: Page, path: string) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);

    const csp = (await response?.headerValue('content-security-policy')) ?? '';
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, `${path} has a nonce in its CSP`).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    const scripts = [...((await response?.text()) ?? '').matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length, `${path} has scripts`).toBeGreaterThan(0);
    for (const tag of scripts) {
        expect(tag, path).toContain(`nonce="${nonce}"`);
    }
}

test.beforeEach(async ({ page }) => {
    await recordCspViolations(page);
});

test('public pages carry the nonce on every script and run without CSP violations', async ({ page }) => {
    await page.route('**/api/issuers', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, issuers: [] }) }),
    );

    for (const path of ['/', '/about', '/solutions/students', '/issuers', '/contact', '/legal/privacy', '/verify']) {
        await expectNonceOnEveryScript(page, path);
        // Hydrated: the navbar's client code ran and wired up the menu button.
        await expect(page.locator('header button').first()).toBeEnabled();
        expect(await cspViolations(page), path).toEqual([]);
    }
});

test('a client-side navigation through a prefetched link stays within the policy', async ({ page }) => {
    // Prefetches skip the proxy (src/proxy.ts); the page they lead to must
    // still render under the policy of the document that requested them.
    await page.goto('/');
    await page.getByRole('link', { name: 'Verify a credential' }).first().hover();
    await page.getByRole('link', { name: 'Verify a credential' }).first().click();
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
});

test('the consoles carry the nonce and run without CSP violations', async ({ page }) => {
    await seedE2eState(page, createE2eState());
    await installE2eRoutes(page);
    await expectNonceOnEveryScript(page, '/dashboard');
    await expect(page.getByRole('navigation').first()).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);

    await seedE2eState(page, createE2eState({ role: 'admin', walletAddress: adminWallet, contractOwner: adminWallet }));
    await expectNonceOnEveryScript(page, '/admin');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
});
