import { expect, test } from '@playwright/test';
import {
    applyE2eState,
    createAdminInstitution,
    createE2eState,
    installE2eRoutes,
    seedE2eState,
} from './e2e-support';

const issuerWallet = 'GAcrediaIssuerWallet0000000000000000000000000000001';
const adminWallet = 'GAcrediaAdminWallet00000000000000000000000000000001';
const studentWallet = 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD';

test('issues, verifies, and revokes a credential', async ({ page }) => {
    const state = createE2eState({
        role: 'institution',
        walletAddress: issuerWallet,
        contractOwner: adminWallet,
        authorizedIssuers: [issuerWallet],
        institution: {
            id: 'inst-1',
            name: 'Acredia Academy',
            walletAddress: issuerWallet,
        },
    });

    await seedE2eState(page, state);
    await installE2eRoutes(page);

    // Public signup was removed (Issue #239): the institution and its POC are
    // provisioned by an admin, so the journey starts from an account that
    // already exists rather than from a registration form.
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

    // Issuance now lives on its own route. Reach it through the sidebar so the
    // institution navigation stays covered.
    const institutionNav = page.getByRole('navigation', { name: 'Institution navigation' });
    await institutionNav.getByRole('link', { name: /Issue credential/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/issue$/);
    await expect(page.getByRole('heading', { name: 'Issue new credential' })).toBeVisible();

    await page.locator('#studentName').fill('Ada Lovelace');
    await page.locator('#studentWallet').fill(studentWallet);
    await page.locator('#degree').fill('Bachelor of Science');
    await page.locator('#issueDate').fill('2024-01-01');
    await page.locator('#fileUpload').setInputFiles({
        name: 'diploma.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 credential'),
    });
    await expect(page.getByText('diploma.pdf')).toBeVisible();

    await page.locator('form').getByRole('button', { name: 'Issue Credential' }).click();
    await expect(page.getByRole('dialog', { name: 'Review Credential' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and Sign' }).click();

    await institutionNav.getByRole('link', { name: /Issued credentials/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/issued$/);
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
    await expect(page.getByText('Token ID: 1').first()).toBeVisible();

    await page.goto('/verify?token=1');
    // One h1 for every /verify state now, so this assertion is state-agnostic
    // and the verdict is asserted separately below (ACREDIA-STELLAR#226).
    await expect(page.getByRole('heading', { name: 'Credential Verification', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toBeVisible();
    await expect(page.getByText('Found on Stellar')).toBeVisible();
    // A token ID shows status only (review §3.11b): nothing about the holder.
    await expect(page.getByText('Ada Lovelace')).toHaveCount(0);

    // Every former tab is deep-linkable now, so the revoke flow can start from
    // the URL instead of replaying a click path.
    await page.goto('/dashboard/issued');
    await expect(page.getByRole('heading', { name: 'Issued credentials', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('dialog', { name: 'Revoke Credential' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke Credential' }).click();
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'Revoked' })).toBeVisible();

    await page.goto('/verify?token=1');
    await expect(page.getByRole('heading', { name: 'Credential Revoked' })).toBeVisible();
    await expect(page.getByText('This credential has been revoked')).toBeVisible();
    await expect(page.getByText('Revoked by issuer')).toBeVisible();
});

test('institution console sections are deep-linkable and reachable on mobile', async ({ page }) => {
    const state = createE2eState({
        role: 'institution',
        walletAddress: issuerWallet,
        authorizedIssuers: [issuerWallet],
    });

    await seedE2eState(page, state);
    await installE2eRoutes(page);

    // Deep link straight into a former tab.
    await page.goto('/dashboard/issued');
    await expect(page.getByRole('heading', { name: 'Issued credentials', level: 1 })).toBeVisible();

    const institutionNav = page.getByRole('navigation', { name: 'Institution navigation' });
    await expect(
        institutionNav.getByRole('link', { name: /Issued credentials/ }),
    ).toHaveAttribute('aria-current', 'page');
    // The section root must not stay highlighted on its sub-routes.
    await expect(institutionNav.getByRole('link', { name: /Overview/ })).not.toHaveAttribute(
        'aria-current',
        'page',
    );

    // Mobile: the sidebar collapses into a drawer.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(institutionNav).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(institutionNav).toBeVisible();

    await institutionNav.getByRole('link', { name: /Batch import/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/batch-import$/);
    // Navigating closes the drawer so the new page is not hidden behind it.
    await expect(institutionNav).toBeHidden();

    const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'the page must not scroll horizontally at 390px').toBe(false);
});

test('authorizes an issuer from the admin dashboard', async ({ page }) => {
    const state = createE2eState({
        role: 'admin',
        walletAddress: adminWallet,
        contractOwner: adminWallet,
        authorizedIssuers: [],
        institution: {
            id: 'inst-1',
            name: 'Acredia Academy',
            walletAddress: issuerWallet,
        },
    });

    await seedE2eState(page, state);
    await installE2eRoutes(page);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

    // Issuer authorization now lives on its own page. Reach it through the
    // sidebar rather than a direct goto, so the admin navigation stays covered.
    await page
        .getByRole('navigation', { name: 'Admin navigation' })
        .getByRole('link', { name: /Authorize issuer/ })
        .click();

    await expect(page).toHaveURL(/\/admin\/authorize$/);
    await expect(page.getByRole('heading', { name: 'Authorize issuer', level: 1 })).toBeVisible();

    await page.getByLabel('Wallet Address to Authorize').fill(issuerWallet);
    await page.getByRole('button', { name: 'Authorize Wallet' }).click();
    await expect(page.getByText('Authorized to issue credentials', { exact: true })).toBeVisible();
});

test('admin console is the only admin landing screen', async ({ page }) => {
    const state = createE2eState({
        role: 'admin',
        walletAddress: adminWallet,
        contractOwner: adminWallet,
        session: {
            user: { id: 'admin-user-1', email: 'admin@acredia.test' },
            access_token: 'e2e-admin-token',
        },
        adminInstitutions: [
            createAdminInstitution({ id: 'inst-1', status: 'pending' }),
            createAdminInstitution({ id: 'inst-2', status: 'verified' }),
        ],
    });

    await seedE2eState(page, state);
    await installE2eRoutes(page);

    // There is exactly one admin console: /dashboard hands admins over to it
    // rather than rendering a second, emptier version of the same thing
    // (docs/decisions/0001-single-admin-console.md).
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

    // ...and the settings entry point admins can be sent to generically.
    await page.goto('/dashboard/settings');
    await expect(page).toHaveURL(/\/admin\/settings$/);

    await page.goto('/admin');

    // The landing screen leads with what needs attention.
    await expect(
        page.getByRole('heading', { name: '1 institution is awaiting review' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Review institutions' }).click();
    await expect(page).toHaveURL(/\/admin\/institutions$/);

    // Identity, wallet state, and sign-out are three separated bands in the
    // sidebar rather than one Account card on the page.
    const sidebar = page.getByRole('navigation', { name: 'Admin navigation' });
    await expect(sidebar).toBeVisible();
    await expect(page.getByText('admin@acredia.test')).toBeVisible();
});

test('the admin wallet gate is unmissable when disconnected and gone when connected', async ({
    page,
}) => {
    const disconnected = createE2eState({
        role: 'admin',
        walletAddress: null,
        contractOwner: adminWallet,
        session: {
            user: { id: 'admin-user-1', email: 'admin@acredia.test' },
            access_token: 'e2e-admin-token',
        },
    });

    await seedE2eState(page, disconnected);
    await installE2eRoutes(page);

    await page.goto('/admin');
    const gate = page.getByRole('heading', { name: 'Wallet connection required' });
    await expect(gate).toBeVisible();

    // The gate is centred in the content area, so the screen does not end
    // half-way down the viewport (ACREDIA-STELLAR#225).
    const filled = await page.evaluate(() => {
        const main = document.querySelector('main');
        const bottom = main?.getBoundingClientRect().bottom ?? 0;
        return bottom / window.innerHeight;
    });
    expect(filled, 'the admin landing screen must not end half-way down').toBeGreaterThan(0.8);

    // Connected: the gate disappears entirely and the wallet becomes a quiet
    // sidebar control.
    await applyE2eState(page, { ...disconnected, walletAddress: adminWallet });

    await expect(gate).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Verification outcomes' })).toBeVisible();
});

test('the verification verdict leads the page at every size', async ({ page }) => {
    const state = createE2eState({
        issuedCredentials: [
            {
                id: 'cred-1',
                token_id: '1',
                ipfs_hash: null,
                blockchain_hash:
                    'a3f1c9e2b7d84f5a1c0e6b9d2f7a4c8e1b5d9f3a7c2e6b0d4f8a1c5e9b3d7f2a',
                metadata: {
                    credentialData: {
                        degree: 'Bachelor of Science',
                        credentialType: 'diploma',
                        issueDate: '2024-01-01',
                    },
                },
                issued_at: new Date().toISOString(),
                revoked: false,
                issuer_wallet_address: issuerWallet,
                student_wallet_address: studentWallet,
            },
        ],
    });

    await seedE2eState(page, state);
    await installE2eRoutes(page);

    const verdict = page.locator('[aria-labelledby="verification-verdict"]');

    for (const size of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
    ]) {
        await page.setViewportSize(size);
        await page.goto('/verify?token=1');

        await expect(verdict).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toBeVisible();

        // The whole point of the page: the answer is readable without scrolling.
        const fold = await verdict.evaluate(
            (node) => node.getBoundingClientRect().bottom <= window.innerHeight,
        );
        expect(fold, `verdict must sit above the fold at ${size.width}px`).toBe(true);

        const overflows = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflows, `no horizontal overflow at ${size.width}px`).toBe(false);
    }

    // Technical identifiers are collapsed until asked for, then copyable — and
    // long hashes must not blow out the narrow viewport.
    const hash = page.getByText('a3f1c9e2b7d84f5a1c0e6b9d2f7a4c8e1b5d9f3a7c2e6b0d4f8a1c5e9b3d7f2a');
    await expect(hash).toBeHidden();

    await page.getByRole('button', { name: /Technical details/ }).click();
    await expect(hash).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy On-chain credential hash' })).toBeVisible();
    // The holder's wallet is not part of a status check.
    await expect(page.getByText(studentWallet)).toHaveCount(0);

    const overflowsExpanded = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowsExpanded, 'expanded hashes must not overflow at 390px').toBe(false);
});

test('an expired credential reads as expired, not revoked', async ({ page }) => {
    await seedE2eState(
        page,
        createE2eState({
            issuedCredentials: [
                {
                    id: 'cred-1',
                    token_id: '1',
                    ipfs_hash: null,
                    blockchain_hash: 'e2e-tx-1',
                    metadata: null,
                    issued_at: '2020-01-01T00:00:00.000Z',
                    // Valid through 2020-12-31 (UTC).
                    expires_at: '2021-01-01T00:00:00.000Z',
                    revoked: false,
                    issuer_wallet_address: issuerWallet,
                    student_wallet_address: studentWallet,
                },
            ],
        }),
    );
    await installE2eRoutes(page);

    await page.goto('/verify?token=1');
    await expect(page.getByRole('heading', { name: 'Credential Expired' })).toBeVisible();
    await expect(
        page.getByText('This credential was valid through December 31, 2020 (UTC)'),
    ).toBeVisible();
    await expect(page.getByText('Not revoked')).toBeVisible();
});

test('every verification state shares one heading', async ({ page }) => {
    await seedE2eState(page, createE2eState({ issuedCredentials: [] }));
    await installE2eRoutes(page);

    const heading = page.getByRole('heading', { name: 'Credential Verification', level: 1 });

    // Entry state (no token), and a lookup that finds nothing.
    await page.goto('/verify');
    await expect(heading).toBeVisible();

    await page.goto('/verify?token=999');
    await expect(page.getByRole('heading', { name: 'Credential Not Found' })).toBeVisible();
    await expect(heading).toBeVisible();
});
