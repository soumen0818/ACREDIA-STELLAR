import { expect, test } from '@playwright/test';

/**
 * The public issuer registry. The page is a Server Component; the list and
 * its search are the one client island (review §4.3).
 */

const issuers = [
    {
        id: 'inst-1',
        name: 'Acredia Academy',
        wallet_address: 'GAcrediaIssuerWallet0000000000000000000000000000001',
        authorization_tx_hash: 'a'.repeat(64),
        verified_at: '2026-10-01T00:00:00.000Z',
    },
    {
        id: 'inst-2',
        name: 'Northbridge University',
        wallet_address: 'GNorthbridgeWallet00000000000000000000000000000002',
        authorization_tx_hash: null,
        verified_at: '2026-09-15T00:00:00.000Z',
    },
];

test('lists verified issuers and filters them by name or wallet', async ({ page }) => {
    await page.route('**/api/issuers', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, issuers }),
        }),
    );

    await page.goto('/issuers');

    await expect(page.getByRole('heading', { name: 'Verified Issuer Registry', level: 1 })).toBeVisible();
    await expect(page.getByText('2 verified issuers')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acredia Academy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Northbridge University' })).toBeVisible();

    const search = page.getByLabel('Search verified issuers');
    await search.fill('northbridge');
    await expect(page.getByText('1 verified issuer matching "northbridge"')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acredia Academy' })).toHaveCount(0);

    await search.fill('GAcrediaIssuer');
    await expect(page.getByRole('heading', { name: 'Acredia Academy' })).toBeVisible();

    await search.fill('nobody');
    await expect(page.getByText('No verified issuers matching "nobody".')).toBeVisible();

    // The server-rendered guidance stays below the list.
    await expect(page.getByText('How to cross-check on-chain')).toBeVisible();
});

test('offers a retry when the registry cannot be loaded', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/issuers', (route) => {
        calls += 1;
        return calls === 1
            ? route.fulfill({
                  status: 500,
                  contentType: 'application/json',
                  body: JSON.stringify({ success: false, error: 'Failed to fetch issuer registry.' }),
              })
            : route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({ success: true, issuers }),
              });
    });

    await page.goto('/issuers');
    await expect(page.getByText('Failed to fetch issuer registry.')).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('2 verified issuers')).toBeVisible();
});
