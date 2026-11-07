import { expect, test } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

/**
 * The institution analytics page. Its charts are loaded on demand rather
 * than with the page (review §4.1); this checks they still arrive and draw.
 * That recharts stays out of the initial JS is checked against the
 * production build, not here: this dev server does not split chunks the
 * same way.
 */

const months = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];

test('shows the analytics summary and draws both monthly charts', async ({ page }) => {
    await seedE2eState(page, createE2eState());
    await installE2eRoutes(page);
    await page.route('**/api/institution/analytics', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                issuedOverTime: months.map((month, i) => ({ month, count: i % 4 })),
                statusBreakdown: { active: 9, revoked: 3, total: 12 },
                verificationsOverTime: months.map((month, i) => ({ month, count: i % 3 })),
                topVerifiedCredentials: [
                    { tokenId: '7', credentialType: 'BSc Physics', studentName: 'Ada Example', count: 5 },
                ],
            }),
        }),
    );

    await page.goto('/dashboard/analytics');

    await expect(page.getByText('Total issued')).toBeVisible();
    await expect(page.getByText('Ada Example')).toBeVisible();

    for (const title of ['Credentials issued (last 12 months)', 'Verifications (last 12 months)']) {
        const card = page.locator('div', { has: page.getByRole('heading', { name: title }) }).last();
        await expect(card.locator('svg.recharts-surface')).toBeVisible();
        await expect(card.locator('.recharts-bar-rectangle').first()).toBeVisible();
    }
});
