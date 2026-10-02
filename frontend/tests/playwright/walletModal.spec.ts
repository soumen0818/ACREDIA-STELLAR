import { expect, test } from '@playwright/test';
import { buildCspString } from '../../src/lib/securityHeaders';

// No seeded E2E state: this exercises the installed Kit's actual modal.
for (const mobile of [false, true]) {
    test(`real wallet chooser supports keyboard navigation and passes axe (${mobile ? '360px viewport' : 'desktop'})`, async ({
        page,
    }) => {
        // Viewport responsiveness, not a real-phone transport claim. With no
        // WalletConnect project configured, /claim blocks phone connection.
        if (mobile) await page.setViewportSize({ width: 360, height: 780 });
        await page.goto('/claim');
        const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
        await connect.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Albedo', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Freighter', { exact: true })).toBeVisible();
        await expect(dialog.getByText('HOT Wallet', { exact: true })).toHaveCount(0);
        const controls = dialog.locator('button:visible, a[href]:visible');
        await expect(controls.first()).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(controls.last()).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(controls.first()).toBeFocused();
        const axeModule = await import('axe-core');
        await page.addScriptTag({ content: axeModule.source ?? axeModule.default.source });
        const violations = await dialog.evaluate(async (element) => {
            const axe = (
                window as unknown as {
                    axe: { run: (root: Element) => Promise<{ violations: unknown[] }> };
                }
            ).axe;
            return (await axe.run(element)).violations;
        });
        expect(violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(connect).toBeFocused();
    });
}

test('production CSP permits wallet HTTP and frame transports and rejects unlisted origins', async ({
    page,
}) => {
    await page.route('**/wallet-csp-probe', (route) =>
        route.fulfill({
            contentType: 'text/html',
            headers: { 'Content-Security-Policy': buildCspString('wallet-probe', true) },
            body: '<!doctype html><html><head><title>Wallet CSP</title></head><body>CSP probe</body></html>',
        }),
    );
    await page.route('https://relay.walletconnect.com/**', (route) =>
        route.fulfill({
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: 'relay-ok',
        }),
    );
    await page.route('https://albedo.link/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>albedo-ok</p>' }),
    );
    await page.routeWebSocket('wss://relay.walletconnect.com/**', (socket) => {
        socket.onMessage((message) => socket.send(`echo:${message}`));
    });
    await page.goto('/wallet-csp-probe');
    expect(
        await page.evaluate(
            () =>
                new Promise<string>((resolve, reject) => {
                    const socket = new WebSocket('wss://relay.walletconnect.com/probe');
                    const timeout = setTimeout(() => {
                        socket.close();
                        reject(new Error('Relay probe timed out'));
                    }, 5000);
                    socket.onopen = () => socket.send('ping');
                    socket.onmessage = (event) => {
                        clearTimeout(timeout);
                        socket.close();
                        resolve(event.data);
                    };
                    socket.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('Relay blocked'));
                    };
                }),
        ),
    ).toBe('echo:ping');
    expect(
        await page.evaluate(async () =>
            (await fetch('https://relay.walletconnect.com/probe')).text(),
        ),
    ).toBe('relay-ok');
    await page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.src = 'https://albedo.link/probe';
        document.body.append(frame);
    });
    await expect(page.frameLocator('iframe').locator('p')).toHaveText('albedo-ok');
    expect(
        await page.evaluate(async () => {
            try {
                await fetch('https://unlisted-wallet.invalid/probe');
                return 'allowed';
            } catch {
                return 'blocked';
            }
        }),
    ).toBe('blocked');
});
