import { expect, test, type Page } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

/**
 * Issue #342: role-gated pages must not render before the role is known.
 *
 * `loading` used to drop as soon as the role lookup *started*, so a student
 * opening /admin briefly got the admin console, which also sent admin API
 * requests. A single check at the end cannot see a flash that has already
 * gone, so a MutationObserver is installed before navigation and records
 * every time admin navigation is attached, and every request is recorded.
 *
 * The role lookup is slowed down (`roleResolutionDelayMs`, E2E builds only)
 * so the window the bug lived in is wide enough to observe reliably.
 */

const ADMIN_NAV = 'nav[aria-label="Admin navigation"], a[href="/admin/institutions"], a[href="/admin/authorize"]';
const adminWallet = 'GAcrediaAdminWallet00000000000000000000000000000001';

/** Records, from before any page script runs, whether admin navigation is ever attached. */
async function watchForAdminNavigation(page: Page) {
    await page.addInitScript((selector) => {
        const seen: string[] = [];
        (window as unknown as { __adminNavSeen: string[] }).__adminNavSeen = seen;
        const check = (node: Node) => {
            if (!(node instanceof Element)) return;
            const match = node.matches(selector) ? node : node.querySelector(selector);
            if (match) seen.push(`${match.tagName.toLowerCase()} ${match.getAttribute('aria-label') ?? match.getAttribute('href')} at ${Math.round(performance.now())}ms`);
        };
        new MutationObserver((mutations) => {
            for (const mutation of mutations) mutation.addedNodes.forEach(check);
        }).observe(document, { childList: true, subtree: true });
    }, ADMIN_NAV);
}

function adminNavigationSeen(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __adminNavSeen: string[] }).__adminNavSeen);
}

/** Every /api/admin request the page sends, from the first navigation on. */
function recordAdminRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.startsWith('/api/admin')) requests.push(`${request.method()} ${pathname}`);
    });
    return requests;
}

for (const delay of [1_500, 0]) {
    test(`a student opening /admin never gets the admin console (role lookup ${delay} ms)`, async ({ page }) => {
        await seedE2eState(page, createE2eState({ role: 'student', roleResolutionDelayMs: delay }));
        await installE2eRoutes(page);
        await watchForAdminNavigation(page);
        const adminRequests = recordAdminRequests(page);

        await page.goto('/admin');

        // Sent on to their own console once the role is known.
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.getByRole('navigation', { name: 'Student navigation' })).toBeVisible();

        expect(await adminNavigationSeen(page), 'admin navigation was attached').toEqual([]);
        expect(adminRequests, 'admin API requests were sent').toEqual([]);
    });
}

test('while the role is being looked up, /admin shows the loading skeleton, not the console', async ({ page }) => {
    await seedE2eState(page, createE2eState({ role: 'student', roleResolutionDelayMs: 3_000 }));
    await installE2eRoutes(page);

    await page.goto('/admin');

    // Inside the lookup window: a skeleton, no console, still on /admin.
    await expect(page.locator('.animate-pulse').first()).toBeVisible();
    await expect(page.locator(ADMIN_NAV)).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin$/);
});

test('an admin still reaches /admin after a slow role lookup', async ({ page }) => {
    await seedE2eState(
        page,
        createE2eState({ role: 'admin', roleResolutionDelayMs: 1_500, walletAddress: adminWallet, contractOwner: adminWallet }),
    );
    await installE2eRoutes(page);
    const adminRequests = recordAdminRequests(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // The console works: it loads its data from the admin API.
    await expect.poll(() => adminRequests.some((request) => request.includes('/api/admin/stats'))).toBe(true);
});
