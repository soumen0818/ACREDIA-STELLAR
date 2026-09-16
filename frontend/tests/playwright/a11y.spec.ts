import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { applyE2eState, createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

async function runAxe(page: Page) {
    // The app can still be settling (hydration / client-side redirect) right
    // after `goto` resolves. Injecting axe mid-navigation destroys the
    // execution context, so wait for the page to go quiet first.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({
        content: `*, *::before, *::after { transition: none !important; animation-duration: 0s !important; opacity: 1 !important; transform: none !important; }`,
    });
    const axeModule = await import('axe-core');
    const axeSource = axeModule.source ?? axeModule.default.source;
    await page.addScriptTag({ content: axeSource });
    return page.evaluate(async () => {
        const axe = (window as unknown as Window & { axe: { run: (node: Element, options: unknown) => Promise<{ violations: Array<{ id: string; impact?: string; help: string }> }> } }).axe;
        return axe.run(document.documentElement, {
            runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa'],
            },
        });
    });
}

/** Audits one route and reports violations against that route by name. */
async function expectNoViolations(page: Page, path: string) {
    await page.goto(path);
    const results = await runAxe(page);
    expect(
        results.violations,
        `${path} violations: ${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([]);
}

function institutionState() {
    return createE2eState({
        role: 'institution',
        walletAddress: 'GAcrediaIssuerWallet0000000000000000000000000000001',
        authorizedIssuers: ['GAcrediaIssuerWallet0000000000000000000000000000001'],
        issuedCredentials: [
            {
                id: 'cred-1',
                token_id: '1',
                ipfs_hash: 'e2e-metadata-cid',
                blockchain_hash: 'e2e-tx-1',
                metadata: {
                    credentialData: {
                        studentName: 'Ada Lovelace',
                        degree: 'Bachelor of Science',
                        credentialType: 'diploma',
                        issueDate: '2024-01-01',
                    },
                },
                issued_at: new Date().toISOString(),
                revoked: false,
                issuer_wallet_address: 'GAcrediaIssuerWallet0000000000000000000000000000001',
                student_wallet_address: 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD',
            },
        ],
    });
}

function adminState() {
    return createE2eState({
        role: 'admin',
        walletAddress: 'GAcrediaAdminWallet00000000000000000000000000000001',
        contractOwner: 'GAcrediaAdminWallet00000000000000000000000000000001',
        authorizedIssuers: [],
        session: {
            user: { id: 'admin-user-1', email: 'admin@acredia.test' },
            access_token: 'e2e-admin-token',
        },
    });
}

/**
 * The WCAG audit is split by area rather than run as one long test.
 *
 * Auditing eleven routes in a single test took ~37s of a 45s budget on a fast
 * developer machine, leaving almost no headroom — on CI's 2-core runner it
 * exceeded the timeout and failed as "Test timeout of 45000ms exceeded", which
 * reads like an accessibility failure but is purely a scheduling one.
 *
 * Splitting gives each group its own budget and, just as importantly, names the
 * failing area instead of reporting a single opaque timeout. Raising the global
 * timeout would have hidden the fragility rather than removed it.
 */
test.describe('WCAG 2.1 AA accessibility audit', () => {
    test('public pages', async ({ page }) => {
        await expectNoViolations(page, '/');
        await expectNoViolations(page, '/about');
        await expectNoViolations(page, '/auth/login');
        // Registration was removed (Issue #239); contact is where onboarding
        // starts now, so that is the page worth auditing.
        await expectNoViolations(page, '/contact');
    });

    test('institution console', async ({ page }) => {
        await seedE2eState(page, institutionState());
        await installE2eRoutes(page);

        await expectNoViolations(page, '/dashboard');
        // The former institution tabs are real routes now, so each one is
        // audited in its own right.
        await expectNoViolations(page, '/dashboard/issue');
        await expectNoViolations(page, '/dashboard/issued');
    });

    test('public verification surfaces', async ({ page }) => {
        await seedE2eState(page, institutionState());
        await installE2eRoutes(page);

        await expectNoViolations(page, '/verify?token=1');
        await expectNoViolations(page, '/credentials/1');
    });

    test('admin console, including the wallet gate', async ({ page }) => {
        await seedE2eState(page, institutionState());
        await installE2eRoutes(page);

        // `applyE2eState` writes to sessionStorage, which throws
        // "Access is denied for this document" on the blank page a fresh
        // context starts on. Navigate first so there is a real origin to
        // write to — the original single-test version got this for free from
        // the preceding audits.
        await page.goto('/');

        // Switching roles has to overwrite the stored state — re-seeding would
        // be ignored and this audit would silently re-check /dashboard.
        const admin = adminState();
        await applyE2eState(page, admin);

        await page.goto('/admin');
        // Guards the role switch above: as an institution this page would
        // redirect to /dashboard and the audit below would pass without ever
        // seeing /admin.
        await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
        let results = await runAxe(page);
        expect(
            results.violations,
            `/admin violations: ${JSON.stringify(results.violations, null, 2)}`,
        ).toEqual([]);

        // The wallet gate is a distinct visual treatment (warning-toned,
        // centred), so it gets audited in its own right (ACREDIA-STELLAR#225).
        await applyE2eState(page, { ...admin, walletAddress: null });

        await page.goto('/admin');
        await expect(page.getByRole('heading', { name: 'Wallet connection required' })).toBeVisible();
        results = await runAxe(page);
        expect(
            results.violations,
            `/admin wallet gate violations: ${JSON.stringify(results.violations, null, 2)}`,
        ).toEqual([]);
    });
});
