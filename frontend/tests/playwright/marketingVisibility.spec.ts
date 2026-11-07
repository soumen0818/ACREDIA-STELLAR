import { expect, test, type Page } from '@playwright/test';

/**
 * Marketing pages are readable before, and without, JavaScript (review
 * §4.3). They used to be client components whose sections started at
 * `opacity: 0` and were faded in by framer-motion, so on a slow phone the
 * page stayed blank until hydration, and the hero headline (the LCP element)
 * was one of the hidden parts.
 *
 * `toBeVisible()` treats `opacity: 0` as visible, so these read the computed
 * opacity instead.
 */

const MARKETING_PAGES = [
    '/',
    '/about',
    '/solutions/students',
    '/solutions/institutions',
    '/issuers',
    '/contact',
    '/legal/privacy',
];

async function opacityOf(page: Page, selector: string): Promise<string> {
    return page.locator(selector).first().evaluate((el) => getComputedStyle(el).opacity);
}

/** Scrolls each `.reveal` section to the middle of the viewport and waits for it to be opaque. */
async function expectRevealsToFinish(page: Page) {
    const reveals = page.locator('.reveal');
    const count = await reveals.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i++) {
        const section = reveals.nth(i);
        await section.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect.poll(() => section.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    }
}

test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    for (const path of MARKETING_PAGES) {
        test(`${path} shows its headline in the server HTML`, async ({ page }) => {
            const response = await page.goto(path);
            const html = (await response?.text()) ?? '';

            // The signature of the old bug: inline styles that hide content
            // until a script removes them.
            expect(html).not.toMatch(/style="[^"]*opacity:\s*0(?:[;"]|\s)/);

            await expect(page.locator('h1')).toBeVisible();
            expect(await opacityOf(page, 'h1')).toBe('1');
        });
    }

    test('sections fade in as they scroll into view, and end fully visible', async ({ page }) => {
        // The fade is CSS alone, so it runs, and finishes, with scripts off.
        await page.goto('/');
        await expectRevealsToFinish(page);
    });
});

test.describe('with reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('sections are fully visible without scrolling', async ({ page }) => {
        await page.goto('/');
        const opacities = await page
            .locator('.reveal')
            .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).opacity));

        expect(opacities.length).toBeGreaterThan(5);
        expect(opacities.every((value) => value === '1')).toBe(true);
    });
});

test('below-the-fold sections wait to fade in when motion is allowed', async ({ page }) => {
    // The counterpart of the reduced-motion test: proves `.reveal` is live here,
    // so that test is not passing merely because nothing animates.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    expect(await opacityOf(page, 'footer')).toBe('1');
    const lastReveal = await page
        .locator('.reveal')
        .last()
        .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(lastReveal).toBeLessThan(1);
});

test('the site navbar stays at the top while the page scrolls', async ({ page }) => {
    // `overflow-x: hidden` on <body> used to make it the navbar's sticky
    // container, so the navbar scrolled away with the page.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    expect(await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
});
