import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoleState } from '../src/types';

/**
 * Settings → account removal (review §3.10). Students see self-service
 * deletion; institution staff and admins are sent to support. The server
 * enforces this either way (tests/accountErasure.test.ts).
 */

const { auth } = vi.hoisted(() => ({
    auth: { role: 'loading' as RoleState },
}));

vi.mock('../src/contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { email: 'person@example.test', user_metadata: {} },
        userRole: auth.role,
        signOut: vi.fn(),
    }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../src/components/settings/AccountInformationPanel', () => ({
    AccountInformationPanel: () => null,
}));
vi.mock('../src/app/dashboard/settings/ApiKeysManager', () => ({ ApiKeysManager: () => null }));

import { AccountSettingsPanels } from '../src/components/settings/AccountSettingsPanels';

function render(role: RoleState): string {
    auth.role = role;
    return renderToStaticMarkup(<AccountSettingsPanels />);
}

describe('account removal on the Settings screen', () => {
    it.each(['student', 'unprovisioned'] as const)('offers %s self-service deletion', (role) => {
        const html = render(role);
        expect(html).toContain('Delete my account');
        expect(html).not.toContain('Request account removal');
    });

    it('tells students their credentials stay verifiable', () => {
        const html = render('student');
        expect(html).toContain('stay valid and verifiable');
        expect(html).not.toContain('For institution admins');
    });

    it.each(['institution', 'admin'] as const)('sends %s accounts to support instead', (role) => {
        const html = render(role);
        expect(html).toContain('Request account removal');
        expect(html).not.toContain('Delete my account');
        expect(html).toContain('href="mailto:');
        expect(html).toContain('subject=Account%20removal%20request');
        expect(html).toContain(encodeURIComponent('person@example.test'));
    });

    it('shows neither option while the role is still loading', () => {
        const html = render('loading');
        expect(html).not.toContain('Delete my account');
        expect(html).not.toContain('Request account removal');
    });
});
