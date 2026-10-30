import { ESLint } from 'eslint';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Explorer links follow the configured network (review §3.4).
 *
 * Three components hardcoded `stellar.expert/explorer/testnet`, so after the
 * mainnet cutover every "view on explorer" link would have opened the wrong
 * network. The helpers now build links from runtimeConfig, and a lint rule
 * keeps network-specific URLs out of the rest of src/.
 */

async function helpersFor(explorerBaseUrl: string) {
    vi.resetModules();
    vi.doMock('@/lib/runtimeConfig', () => ({
        runtimeConfig: {
            contracts: { CREDENTIAL_NFT: '', CREDENTIAL_REGISTRY: '' },
            stellar: {
                kind: 'custom',
                horizonUrl: 'https://horizon.example.test',
                sorobanRpcUrl: 'https://rpc.example.test',
                networkPassphrase: 'Test',
                networkName: 'ignored-for-links',
                explorerBaseUrl,
            },
            debug: { enableLogs: false },
        },
    }));
    return import('@/lib/stellar');
}

afterEach(() => {
    vi.doUnmock('@/lib/runtimeConfig');
    vi.resetModules();
});

describe('explorer link helpers', () => {
    it.each([
        ['testnet', 'https://stellar.expert/explorer/testnet'],
        ['mainnet', 'https://stellar.expert/explorer/public'],
        ['a custom explorer', 'https://explorer.example.test/net'],
    ])('build %s links from the configured explorer', async (_label, base) => {
        const { getExplorerTxUrl, getExplorerAddressUrl } = await helpersFor(base);
        expect(getExplorerTxUrl('abc123')).toBe(`${base}/tx/abc123`);
        expect(getExplorerAddressUrl('GABC')).toBe(`${base}/account/GABC`);
    });

    it('does not double the slash when the configured base ends with one', async () => {
        const { getExplorerTxUrl } = await helpersFor('https://stellar.expert/explorer/public/');
        expect(getExplorerTxUrl('abc')).toBe('https://stellar.expert/explorer/public/tx/abc');
    });
});

describe('lint guard against network-specific Stellar URLs', () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    async function restrictedSyntaxErrors(code: string, filePath: string): Promise<number> {
        const [result] = await eslint.lintText(code, { filePath });
        return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
    }

    it('flags a hardcoded testnet explorer link in a string or template', async () => {
        const code = [
            "export const a = 'https://stellar.expert/explorer/testnet/tx/abc';",
            'export const b = (h: string) => `https://stellar.expert/explorer/public/tx/${h}`;',
            "export const c = 'https://horizon-testnet.stellar.org';",
        ].join('\n');
        expect(await restrictedSyntaxErrors(code, 'src/components/Example.tsx')).toBe(3);
    });

    it('allows the network profile itself and network-neutral links', async () => {
        const profile = "export const p = 'https://stellar.expert/explorer/testnet';";
        expect(await restrictedSyntaxErrors(profile, 'src/lib/runtimeConfig.ts')).toBe(0);

        const neutral = "export const home = 'https://stellar.expert';";
        expect(await restrictedSyntaxErrors(neutral, 'src/components/Example.tsx')).toBe(0);
    });
});
