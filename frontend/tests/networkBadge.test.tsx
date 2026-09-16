import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The network badge is a trust claim, not decoration: it tells a visitor which
 * ledger the credential they are looking at actually lives on.
 *
 * Two components previously hardcoded the string "Live on Stellar Testnet" with
 * no network check, so a mainnet deployment would have told every visitor it was
 * on testnet. These tests pin the derived behaviour so that cannot return.
 */
// `networkName` is free-form (mainnet reports "public", a custom network can be
// anything), so it must not inherit the narrow union type of `kind`.
async function renderBadgeFor(
    kind: 'testnet' | 'mainnet' | 'custom',
    networkName: string = kind,
) {
    vi.resetModules();
    vi.doMock('../src/lib/stellar', () => ({
        activeNetwork: { kind, networkName },
    }));

    const { NetworkBadge, networkLabel } = await import(
        '../src/components/marketing/NetworkBadge'
    );

    return { html: renderToStaticMarkup(<NetworkBadge />), label: networkLabel() };
}

describe('NetworkBadge', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('../src/lib/stellar');
        vi.resetModules();
    });

    it('says Testnet on testnet', async () => {
        const { html, label } = await renderBadgeFor('testnet');
        expect(label).toBe('Live on Stellar Testnet');
        expect(html).toContain('Live on Stellar Testnet');
        expect(html).not.toContain('Mainnet');
    });

    it('says Mainnet on mainnet — never the testnet string', async () => {
        const { html, label } = await renderBadgeFor('mainnet', 'public');
        expect(label).toBe('Live on Stellar Mainnet');
        expect(html).toContain('Live on Stellar Mainnet');
        // The regression this guards against: a mainnet deployment claiming testnet.
        expect(html).not.toContain('Testnet');
    });

    it('names a custom network rather than guessing', async () => {
        const { label } = await renderBadgeFor('custom', 'standalone');
        expect(label).toBe('Custom Stellar network');
    });

    it('marks only testnet with the warning colour', async () => {
        const testnet = await renderBadgeFor('testnet');
        expect(testnet.html).toContain('warning');

        // Mainnet is the normal state and must not render as a warning.
        const mainnet = await renderBadgeFor('mainnet', 'public');
        expect(mainnet.html).not.toContain('warning');
        expect(mainnet.html).toContain('success');
    });

    it('supports the inverted tone used on dark auth panels', async () => {
        vi.resetModules();
        vi.doMock('../src/lib/stellar', () => ({
            activeNetwork: { kind: 'testnet', networkName: 'testnet' },
        }));
        const { NetworkBadge } = await import('../src/components/marketing/NetworkBadge');

        const inverted = renderToStaticMarkup(<NetworkBadge tone="inverted" />);
        const normal = renderToStaticMarkup(<NetworkBadge />);

        expect(inverted).toContain('text-white/60');
        // The default tone is a bordered pill; the inverted tone is not.
        expect(normal).toContain('border');
        expect(inverted).not.toContain('text-white/60 rounded-full border');
    });
});
