import { expect, test } from '@playwright/test';

/**
 * The public status page and health endpoint (Issue #312): an employer whose
 * check failed can tell an Acredia outage from a bad credential, without an
 * account.
 */

test('/status is public and states each service in plain words', async ({ page }) => {
    const response = await page.goto('/status');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/status$/); // not redirected to sign-in

    await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    await expect(page.locator('#status-headline')).toHaveText(
        /All systems operational|Some services are degraded|Acredia is having an outage/,
    );

    const services = page.getByRole('list', { name: 'Services' });
    for (const name of ['Verification', 'Sign-in and consoles', 'Shared credentials and documents', 'Abuse protection']) {
        await expect(services.getByText(`${name}:`, { exact: false })).toHaveCount(1);
    }
    await expect(services).toContainText(/Verification:\s*(Operational|Degraded|Unavailable)/);
    await expect(page.getByText(/Last checked/)).toBeVisible();

    // Nothing an engineer would read: no hostnames or internals on the page.
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/supabase|soroban|upstash|redis|rpc\b|https?:\/\//i);
});

test('/api/health reports each dependency in fixed words', async ({ request }) => {
    const response = await request.get('/api/health');
    expect([200, 503]).toContain(response.status());

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'dependencies', 'status']);
    expect(Object.keys(body.dependencies).sort()).toEqual(['auth', 'blockchain', 'database', 'rateLimiting', 'storage']);
    for (const value of [body.status, ...Object.values(body.dependencies)]) {
        expect(['operational', 'degraded', 'outage']).toContain(value);
    }
});

test('the "Verification Unavailable" verdict links to /status', async ({ page }) => {
    await page.route('**/api/verify/**', (route) =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'Verification is temporarily unavailable.' }),
        }),
    );

    await page.goto('/verify?token=1');
    await expect(page.getByRole('heading', { name: 'Verification Unavailable' })).toBeVisible();

    const link = page.locator('main').getByRole('link', { name: /system status/i });
    await expect(link).toHaveAttribute('href', '/status');
    await link.click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
});

test('a not-found verdict does not send the verifier to the status page', async ({ page }) => {
    await page.route('**/api/verify/**', (route) =>
        route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'Credential not found' }),
        }),
    );

    await page.goto('/verify?token=999');
    await expect(page.getByRole('heading', { name: 'Credential Not Found' })).toBeVisible();
    await expect(page.locator('main a[href="/status"]')).toHaveCount(0);
});
