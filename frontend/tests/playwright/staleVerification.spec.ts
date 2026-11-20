import { expect, test, type Page } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

/**
 * Issue #313: when the ledger cannot be read, the last known answer is shown
 * with its age, and a possibly outdated revocation status is flagged. "We
 * cannot check right now" is never shown as invalid, nor as valid undated.
 */

const CHECKED_AT = '2026-11-20T09:15:00.000Z';
const SHOWN = 'November 20, 2026 at 9:15 AM UTC';
const ISSUER = 'GAcrediaIssuerWallet0000000000000000000000000000001';
const STUDENT = 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD';
const SHARE_TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function credential(status: 'valid' | 'revoked') {
    return {
        tokenId: '1',
        status,
        issuedAt: '2026-01-15T00:00:00.000Z',
        expiresAt: null,
        revoked: status === 'revoked',
        revokedAt: status === 'revoked' ? '2026-06-01T00:00:00.000Z' : null,
        revocationSource: status === 'revoked' ? 'issuer' : null,
        institutionName: 'Acredia Academy',
        institutionWallet: ISSUER,
        onChainHash: 'ab'.repeat(32),
    };
}

function staleVerification(status: 'valid' | 'revoked') {
    return {
        verified: false,
        status,
        revoked: status === 'revoked',
        expired: false,
        revocationSource: status === 'revoked' ? 'issuer' : null,
        onChainFound: true,
        issuerAuthorized: true,
        issuerStatus: 'active',
        stale: true,
        checkedAt: CHECKED_AT,
        revocationStatusMayBeOutdated: status !== 'revoked',
        issuerStatusMayBeOutdated: true,
    };
}

async function serveVerify(page: Page, body: unknown, status = 200) {
    await page.route('**/api/verify/**', (route) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
    );
}

test.describe('verify page', () => {
    test('shows a stale valid answer with its age, flagged, and not as a live "Verified ✓"', async ({ page }) => {
        await serveVerify(page, { success: true, credential: credential('valid'), verification: staleVerification('valid') });
        await page.goto('/verify?token=1');

        await expect(page.getByRole('heading', { name: `Verified as of ${SHOWN}` })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toHaveCount(0);

        const notice = page.getByTestId('stale-answer-notice');
        await expect(notice).toContainText(`As of ${SHOWN}.`);
        await expect(notice).toContainText('revocation status may be out of date');
        await expect(notice.getByRole('link', { name: 'Check system status' })).toHaveAttribute('href', '/status');

        await expect(page.getByText('Not revoked when last checked')).toBeVisible();
        await expect(page.getByText(`Last known answer, checked ${SHOWN}`)).toBeVisible();
    });

    test('shows a stale revocation as revoked, dated, without doubting it', async ({ page }) => {
        await serveVerify(page, { success: true, credential: credential('revoked'), verification: staleVerification('revoked') });
        await page.goto('/verify?token=1');

        await expect(page.getByRole('heading', { name: 'Credential Revoked' })).toBeVisible();
        const notice = page.getByTestId('stale-answer-notice');
        await expect(notice).toContainText(`As of ${SHOWN}.`);
        await expect(notice).not.toContainText('may be out of date');
    });

    test('refuses an undated stale answer: shown as unavailable, never as valid', async ({ page }) => {
        const verification = { ...staleVerification('valid'), checkedAt: null };
        await serveVerify(page, { success: true, credential: credential('valid'), verification });
        await page.goto('/verify?token=1');

        await expect(page.getByRole('heading', { name: 'Verification Unavailable' })).toBeVisible();
        await expect(page.getByText(/Verified/)).toHaveCount(0);
    });

    test('a total outage reads as unavailable, never as invalid', async ({ page }) => {
        await serveVerify(page, { success: false, error: 'Blockchain verification unavailable' }, 503);
        await page.goto('/verify?token=1');

        await expect(page.getByRole('heading', { name: 'Verification Unavailable' })).toBeVisible();
        await expect(page.getByRole('heading', { name: /Not Found|Revoked|Could Not Be Verified/ })).toHaveCount(0);
    });

    test('a live answer shows no stale notice', async ({ page }) => {
        await serveVerify(page, {
            success: true,
            credential: credential('valid'),
            verification: { ...staleVerification('valid'), verified: true, stale: false, revocationStatusMayBeOutdated: false, issuerStatusMayBeOutdated: false },
        });
        await page.goto('/verify?token=1');

        await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toBeVisible();
        await expect(page.getByTestId('stale-answer-notice')).toHaveCount(0);
    });
});

test('share page shows a stale answer with its age, on the verdict and the badge', async ({ page }) => {
    await seedE2eState(page, createE2eState());
    await installE2eRoutes(page);
    // Registered last, so it answers before the e2e share route.
    await page.route('**/api/credentials/share/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                credential: {
                    ...credential('valid'),
                    studentWallet: STUDENT,
                    transactionHash: 'e2e-tx-1',
                    details: {
                        studentName: 'Ada Lovelace',
                        credentialType: 'diploma',
                        degree: 'Bachelor of Science in Computer Science',
                        major: null,
                        gpa: null,
                        issueDate: '2026-01-15',
                        institutionName: 'Acredia Academy',
                        subjects: [],
                    },
                    metadata: null,
                    metadataSchemaVersion: null,
                    hashAlgorithm: null,
                    document: null,
                    documentStatus: 'none',
                },
                verification: { ...staleVerification('valid'), contentMatches: true, mismatchReason: null },
            }),
        }),
    );

    await page.goto(`/credentials/${SHARE_TOKEN}`);

    await expect(page.getByRole('heading', { name: `Verified as of ${SHOWN}` })).toBeVisible();
    await expect(page.getByTestId('stale-answer-notice')).toContainText('revocation status may be out of date');
    await expect(page.locator('[data-slot="badge"]').filter({ hasText: `Verified as of ${SHOWN}` })).toBeVisible();
    await expect(page.getByText('Blockchain Verified')).toHaveCount(0);
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
});
