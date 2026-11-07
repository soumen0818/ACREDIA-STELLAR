import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The real client needs Supabase credentials; the provider only subscribes to it.
vi.mock('../src/lib/supabase', () => ({
    supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } },
    signOut: vi.fn(),
    safeGetSession: vi.fn(async () => ({ data: { session: null } })),
}));

import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { StellarProvider, useStellarAccount } from '../src/contexts/StellarContext';

/**
 * The session and wallet providers are mounted only by app/(console)/layout.tsx
 * and app/claim/layout.tsx (review §4.1). A component rendered anywhere else
 * must fail loudly: with a default value it would look signed out and
 * walletless, and nothing would say why.
 */

function WalletAddress() {
    return <span>{useStellarAccount().address ?? 'no wallet'}</span>;
}

function SessionState() {
    const { loading, user } = useAuth();
    return <span>{loading ? 'loading' : (user?.email ?? 'signed out')}</span>;
}

describe('useStellarAccount', () => {
    it('throws outside a StellarProvider', () => {
        expect(() => renderToStaticMarkup(<WalletAddress />)).toThrow(
            'useStellarAccount must be used within a StellarProvider',
        );
    });

    it('reads the provider inside one', () => {
        expect(
            renderToStaticMarkup(
                <StellarProvider>
                    <WalletAddress />
                </StellarProvider>,
            ),
        ).toBe('<span>no wallet</span>');
    });
});

describe('useAuth', () => {
    it('throws outside an AuthProvider', () => {
        expect(() => renderToStaticMarkup(<SessionState />)).toThrow(
            'useAuth must be used within an AuthProvider',
        );
    });

    it('reads the provider inside one', () => {
        expect(
            renderToStaticMarkup(
                <AuthProvider>
                    <SessionState />
                </AuthProvider>,
            ),
        ).toBe('<span>loading</span>');
    });
});
