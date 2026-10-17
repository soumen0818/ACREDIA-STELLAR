import { expect, test } from '@playwright/test';
import { createE2eState, installE2eRoutes, seedE2eState, soloTeam } from './e2e-support';

/**
 * Institution team management in the browser (Issue #307): the persistent
 * single-point-of-contact warning, inviting a second member, and the guard
 * that refuses — loudly — to leave an institution without an owner.
 */

test.describe('institution team and continuity', () => {
    test('warns a single-member institution on every console page until a second member joins', async ({ page }) => {
        await seedE2eState(page, createE2eState());
        await installE2eRoutes(page);

        await page.goto('/dashboard');
        const banner = page.getByRole('region', { name: 'Team continuity' });
        await expect(banner).toContainText('Only one person can issue credentials for your institution');

        // Persistent: it follows the user around the console.
        await page.goto('/dashboard/issued');
        await expect(banner).toBeVisible();

        // …and has no dismiss control.
        await expect(banner.getByRole('button', { name: /dismiss|close/i })).toHaveCount(0);

        await banner.getByRole('link', { name: 'Add a member' }).click();
        await expect(page).toHaveURL(/\/dashboard\/team$/);
        await expect(page.getByRole('heading', { name: 'Continuity' })).toBeVisible();
        await expect(page.getByText('Single point of contact')).toBeVisible();
    });

    test('lets an owner invite a colleague without an Acredia admin', async ({ page }) => {
        await seedE2eState(page, createE2eState());
        await installE2eRoutes(page);
        await page.goto('/dashboard/team');

        await page.getByRole('button', { name: 'Invite', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Invite a team member' });
        await dialog.getByLabel('Full name').fill('Sam Second');
        await dialog.getByLabel('Work email').fill('sam@acredia.test');
        // Owner is pre-selected: the recommended role for continuity.
        await expect(dialog.getByRole('radio', { name: /Owner/ })).toBeChecked();
        await dialog.getByRole('button', { name: 'Send invitation' }).click();

        await expect(page.getByText('Invitation emailed to sam@acredia.test')).toBeVisible();
        const row = page.getByRole('listitem').filter({ hasText: 'Sam Second' });
        await expect(row.getByText('Invited', { exact: true })).toBeVisible();

        // A pending invitation is progress, not continuity: the warning stays,
        // and says so.
        await page.goto('/dashboard');
        await expect(page.getByRole('region', { name: 'Team continuity' })).toContainText('invitation is pending');
    });

    test('refuses, visibly, to remove the last owner', async ({ page }) => {
        await seedE2eState(page, createE2eState());
        await installE2eRoutes(page);
        await page.goto('/dashboard/team');

        await page.getByRole('button', { name: 'Leave team' }).click();
        const dialog = page.getByRole('dialog', { name: 'Leave this institution?' });
        await dialog.getByRole('button', { name: 'Leave team' }).click();

        await expect(dialog.getByRole('alert')).toContainText('This is the only owner');
        // Still a member — nothing happened silently.
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listitem').filter({ hasText: 'Acredia User' })).toBeVisible();
    });

    test('shows no warning once two people can issue and manage the team', async ({ page }) => {
        await seedE2eState(page, createE2eState());
        await installE2eRoutes(page, {
            team: [
                ...soloTeam(),
                { id: 'member-2', name: 'Olu Other', email: 'olu@acredia.test', role: 'owner', status: 'active' },
            ],
        });

        await page.goto('/dashboard/team');
        await expect(page.getByText('Covered')).toBeVisible();

        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Team continuity' })).toHaveCount(0);
    });
});
