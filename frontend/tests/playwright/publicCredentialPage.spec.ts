import { expect, test } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState } from './e2e-support';

const studentWallet = 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD';
const issuerWallet = 'GAcrediaIssuerWallet0000000000000000000000000000001';
const shareToken = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

test('renders public credential showcase page with verify CTA, QR, LinkedIn, and export buttons', async ({ page }) => {
    const state = createE2eState({
        role: 'student',
        walletAddress: studentWallet,
        issuedCredentials: [
            {
                id: 'cred-1',
                token_id: '1',
                share_token: shareToken,
                ipfs_hash: null,
                blockchain_hash: 'e2e-tx-1',
                metadata: {
                    credentialData: {
                        studentName: 'Ada Lovelace',
                        degree: 'Bachelor of Science in Computer Science',
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

    await page.goto(`/credentials/${shareToken}`);
    await expect(page.getByRole('heading', { name: 'Academic Credential', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bachelor of Science in Computer Science' })).toBeVisible();
    // The share link shows the holder; a bare token ID never does.
    await expect(page.getByText('Ada Lovelace')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Verify Credential' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'QR Code' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to LinkedIn' })).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Download Verifiable Credential (.json)' }),
    ).toBeVisible();

    // The QR code and its link carry the share link, and say who can see it.
    await page.getByRole('button', { name: 'QR Code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share Credential' });
    await expect(dialog.getByText('Anyone with this QR code or link can see')).toBeVisible();
    await expect(dialog.getByLabel('Share Link')).toHaveValue(new RegExp(`/credentials/${shareToken}$`));
});

test('an old token-ID link shows status only', async ({ page }) => {
    await seedE2eState(
        page,
        createE2eState({
            issuedCredentials: [
                {
                    id: 'cred-1',
                    token_id: '1',
                    share_token: shareToken,
                    ipfs_hash: null,
                    blockchain_hash: 'e2e-tx-1',
                    metadata: { credentialData: { studentName: 'Ada Lovelace', degree: 'BSc' } },
                    issued_at: new Date().toISOString(),
                    revoked: false,
                    issuer_wallet_address: issuerWallet,
                    student_wallet_address: studentWallet,
                },
            ],
        }),
    );
    await installE2eRoutes(page);

    await page.goto('/credentials/1');
    await expect(page).toHaveURL(/\/verify\?token=1$/);
    await expect(page.getByRole('heading', { name: 'Credential Verified ✓' })).toBeVisible();
    await expect(page.getByText('Ada Lovelace')).toHaveCount(0);
});

test('an unknown share link says so', async ({ page }) => {
    await seedE2eState(page, createE2eState({ issuedCredentials: [] }));
    await installE2eRoutes(page);

    await page.goto('/credentials/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Credential Not Found' })).toBeVisible();
    await expect(page.getByText('This share link does not match any credential.')).toBeVisible();
});
