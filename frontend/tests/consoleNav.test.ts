import { describe, expect, it } from 'vitest';
import {
    CONSOLE_NAV,
    getConsoleNav,
    isConsoleNavItemActive,
    type ConsoleNavItem,
} from '../src/lib/consoleNav';

describe('Console Navigation & Role Scoping', () => {
    it('provides admin-scoped navigation items', () => {
        const nav = getConsoleNav('admin');
        expect(nav.badge).toBe('Admin');
        expect(nav.navLabel).toBe('Admin navigation');

        const hrefs = nav.items.map((item) => item.href);
        expect(hrefs).toContain('/admin');
        expect(hrefs).toContain('/admin/institutions');
        expect(hrefs).toContain('/admin/authorize');
        expect(hrefs).toContain('/admin/settings');
    });

    it('provides institution-scoped navigation items for deep-linkable sections', () => {
        const nav = getConsoleNav('institution');
        expect(nav.badge).toBe('Institution');
        expect(nav.navLabel).toBe('Institution navigation');

        const hrefs = nav.items.map((item) => item.href);
        expect(hrefs).toContain('/dashboard');
        expect(hrefs).toContain('/dashboard/issue');
        expect(hrefs).toContain('/dashboard/batch-import');
        expect(hrefs).toContain('/dashboard/issued');
        expect(hrefs).toContain('/dashboard/analytics');
        expect(hrefs).toContain('/dashboard/settings');
        // Issue #307: an institution manages its own members.
        expect(hrefs).toContain('/dashboard/team');
    });

    it('provides student-scoped navigation items', () => {
        const nav = getConsoleNav('student');
        expect(nav.badge).toBe('Student');
        expect(nav.navLabel).toBe('Student navigation');

        const hrefs = nav.items.map((item) => item.href);
        expect(hrefs).toContain('/dashboard');
        expect(hrefs).toContain('/dashboard/credentials');
        expect(hrefs).toContain('/dashboard/wallet');
        expect(hrefs).toContain('/dashboard/settings');
    });

    it('provides a safe least-privileged fallback for unresolved or unprovisioned states', () => {
        const fallbackNav = getConsoleNav('unprovisioned');
        expect(fallbackNav.badge).toBe('Account');
        expect(fallbackNav.items.map((i) => i.href)).toEqual(['/dashboard', '/dashboard/settings']);
    });

    it('correctly evaluates exact vs prefix active states', () => {
        const overviewItem = CONSOLE_NAV.institution.items.find((i) => i.href === '/dashboard') as ConsoleNavItem;
        expect(overviewItem.exact).toBe(true);

        // Overview is active ONLY on exact /dashboard
        expect(isConsoleNavItemActive('/dashboard', overviewItem)).toBe(true);
        expect(isConsoleNavItemActive('/dashboard/issued', overviewItem)).toBe(false);

        const institutionsItem = CONSOLE_NAV.admin.items.find((i) => i.href === '/admin/institutions') as ConsoleNavItem;
        // Non-exact items stay active on sub-routes
        expect(isConsoleNavItemActive('/admin/institutions', institutionsItem)).toBe(true);
        expect(isConsoleNavItemActive('/admin/institutions/inst-123', institutionsItem)).toBe(true);
        expect(isConsoleNavItemActive('/admin/authorize', institutionsItem)).toBe(false);
    });
});
