import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wallet boundary and its capability handling (ACREDIA-STELLAR#272).
 *
 * The regressions worth protecting against here are the quiet ones:
 *
 *  - A wallet that cannot sign messages letting a student all the way to the
 *    final step of `/claim` before dead-ending.
 *  - The silent-restore path opening a wallet popup on page load. That
 *    property was a comment in the old Freighter code and nothing enforced
 *    it, which is exactly how it would have been lost.
 *  - The kit being pinned to testnet while the app runs on mainnet.
 */

const KIT_PATH = '@creit.tech/stellar-wallets-kit';

/** Mock kit whose calls are all observable. */
function createKitMock() {
    return {
        init: vi.fn(),
        setWallet: vi.fn(),
        setTheme: vi.fn(),
        getAddress: vi.fn(async () => ({ address: 'GADDRESS' })),
        // If any test provokes this, the silent-restore guarantee is broken:
        // fetchAddress is the call that can raise a wallet popup.
        fetchAddress: vi.fn(async () => ({ address: 'GSIGNER' })),
        authModal: vi.fn(async () => ({ address: 'GADDRESS' })),
        signTransaction: vi.fn(async () => ({ signedTxXdr: 'SIGNED_XDR' })),
        signMessage: vi.fn(async () => ({ signedMessage: 'c2lnbmF0dXJl' })),
        disconnect: vi.fn(async () => {}),
        refreshSupportedWallets: vi.fn(async () => [
            { id: 'freighter', name: 'Freighter', isAvailable: true },
            { id: 'rabet', name: 'Rabet', isAvailable: false },
        ]),
        selectedModule: { productId: 'freighter' } as { productId: string } | undefined,
    };
}

type KitMock = ReturnType<typeof createKitMock>;

let kitMock: KitMock;
let walletConnectFails = false;

/** Every wallet module the adapter registers, stubbed. */
function stubWalletModules() {
    const moduleNames: Array<[string, string]> = [
        ['freighter', 'FreighterModule'],
        ['xbull', 'xBullModule'],
        ['albedo', 'AlbedoModule'],
        ['rabet', 'RabetModule'],
        ['lobstr', 'LobstrModule'],
        ['hana', 'HanaModule'],
        ['hotwallet', 'HotWalletModule'],
        ['klever', 'KleverModule'],
        ['onekey', 'OneKeyModule'],
        ['bitget', 'BitgetModule'],
    ];

    for (const [subpath, exportName] of moduleNames) {
        vi.doMock(`${KIT_PATH}/modules/${subpath}`, () => ({
            [exportName]: class {
                productId = subpath;
            },
        }));
    }
}

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * Installs the mocks the adapter needs, optionally on a different network.
 *
 * `@/lib/stellar` is mocked rather than imported: the real module constructs a
 * Stellar SDK RPC server at module scope, which drags in axios and fails
 * against the synthetic `window` below.
 */
function installMocks(
    networkPassphrase = TESTNET_PASSPHRASE,
    { walletConnectProjectId = null as string | null } = {},
) {
    vi.doMock(KIT_PATH, () => ({ StellarWalletsKit: kitMock }));
    stubWalletModules();
    vi.doMock('@/lib/stellar', () => ({
        activeNetwork: { networkPassphrase, networkName: 'testnet' },
    }));
    vi.doMock('@/lib/runtimeConfig', () => ({
        runtimeConfig: {
            walletConnect: {
                projectId: walletConnectProjectId,
                appName: 'Acredia',
                appUrl: 'https://acredia.test',
            },
        },
    }));
    vi.doMock('@/lib/debug', () => ({
        debugWarn: vi.fn(),
        debugLog: vi.fn(),
        captureException: vi.fn(),
    }));
    vi.doMock(`${KIT_PATH}/modules/wallet-connect`, () => ({
        WalletConnectModule: class {
            productId = 'wallet_connect';
            constructor(public params: unknown) {
                if (walletConnectFails) throw new Error('bundle unavailable');
            }
        },
        WalletConnectTargetChain: { PUBLIC: 'stellar:pubnet', TESTNET: 'stellar:testnet' },
    }));
}

/** The module ids the adapter registered, in order. */
function registeredModuleIds(): string[] {
    const init = kitMock.init.mock.calls[0]?.[0] as { modules: Array<{ productId: string }> };
    return init.modules.map((module) => module.productId);
}

beforeEach(() => {
    vi.resetModules();
    kitMock = createKitMock();
    walletConnectFails = false;
    installMocks();

    // jsdom is not configured for this suite (environment: 'node'), so stand
    // in the browser APIs the adapter and theme reader touch. `location` is
    // present because libraries sniff for it to decide they are in a browser.
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
        location: { href: 'http://localhost/' },
        localStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
        },
    });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('document', { documentElement: {} });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

async function loadAdapter() {
    const mod = await import('../src/lib/wallet/adapter');
    return mod;
}

/** Makes `isMobileBrowser()` report a phone for the current test. */
function pretendMobile() {
    vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)',
        maxTouchPoints: 5,
    });
}

describe('module registration by device', () => {
    it('registers supported wallets on desktop', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();

        const ids = registeredModuleIds();
        expect(ids).toContain('freighter');
        expect(ids).toContain('albedo');
        expect(ids).toContain('bitget');
    });

    it('does not register HOT Wallet and clears an obsolete stored selection', async () => {
        window.localStorage.setItem('acredia.wallet.selectedId', 'hot-wallet');
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();
        expect(registeredModuleIds()).not.toContain('hotwallet');
        expect(kitMock.init).toHaveBeenCalledWith(
            expect.objectContaining({ selectedWalletId: undefined }),
        );
    });

    it('shows install links on desktop but not on mobile', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();

        // On desktop "install" is a real next step; on a phone it is an
        // instruction the device cannot follow (ACREDIA-STELLAR#4).
        expect(kitMock.init.mock.calls[0]?.[0]).toMatchObject({
            authModal: { showInstallLabel: true },
        });
    });

    it('registers no desktop extensions on a phone', async () => {
        pretendMobile();
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();

        // Registering them would fill the modal with rows reading "Install"
        // beside wallets that cannot exist on that device — the same dead end,
        // relocated into the modal.
        expect(registeredModuleIds()).toEqual(['albedo']);
        expect(kitMock.init.mock.calls[0]?.[0]).toMatchObject({
            authModal: { showInstallLabel: false },
        });
    });
});

describe('WalletConnect registration', () => {
    it('is absent when no project id is configured', async () => {
        // Deployment configuration, not an error: its absence must leave a
        // clean list rather than a broken entry.
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();

        expect(registeredModuleIds()).not.toContain('wallet_connect');
    });

    it('leads the list once configured, so a phone sees it first', async () => {
        vi.resetModules();
        installMocks(TESTNET_PASSPHRASE, { walletConnectProjectId: 'wc-project-id' });
        pretendMobile();

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await stellarKitAdapter.connect();

        // First, because on a phone it is the only option that can complete
        // `/claim`.
        expect(registeredModuleIds()).toEqual(['wallet_connect', 'albedo']);
    });

    it('asks the wallet to approve the app’s own network, not the kit default', async () => {
        vi.resetModules();
        installMocks(TESTNET_PASSPHRASE, { walletConnectProjectId: 'wc-project-id' });

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await stellarKitAdapter.connect();

        // The module defaults `allowedChains` to PUBLIC. Left alone, a testnet
        // deployment would ask for a mainnet session.
        const init = kitMock.init.mock.calls[0]?.[0] as {
            modules: Array<{ productId: string; params?: { allowedChains?: string[] } }>;
        };
        const wc = init.modules.find((m) => m.productId === 'wallet_connect');
        expect(wc?.params?.allowedChains).toEqual(['stellar:testnet']);
    });

    it('follows activeNetwork onto mainnet', async () => {
        vi.resetModules();
        installMocks('Public Global Stellar Network ; September 2015', {
            walletConnectProjectId: 'wc-project-id',
        });

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await stellarKitAdapter.connect();

        const init = kitMock.init.mock.calls[0]?.[0] as {
            modules: Array<{ productId: string; params?: { allowedChains?: string[] } }>;
        };
        const wc = init.modules.find((m) => m.productId === 'wallet_connect');
        expect(wc?.params?.allowedChains).toEqual(['stellar:pubnet']);
    });

    it('carries the real app identity into the wallet approval screen', async () => {
        vi.resetModules();
        installMocks(TESTNET_PASSPHRASE, { walletConnectProjectId: 'wc-project-id' });

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await stellarKitAdapter.connect();

        // Shown to the student while they approve; a placeholder origin here
        // reads as phishing at the moment trust matters most.
        const init = kitMock.init.mock.calls[0]?.[0] as {
            modules: Array<{ productId: string; params?: { metadata?: { url?: string } } }>;
        };
        const wc = init.modules.find((m) => m.productId === 'wallet_connect');
        expect(wc?.params?.metadata?.url).toBe('https://acredia.test');
    });

    it('degrades to no WalletConnect when the module fails to load', async () => {
        vi.resetModules();
        installMocks(TESTNET_PASSPHRASE, { walletConnectProjectId: 'wc-project-id' });
        walletConnectFails = true;

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');

        // A misconfigured id must never be what makes the Connect button throw.
        await expect(stellarKitAdapter.connect()).resolves.toBeTruthy();
        expect(registeredModuleIds()).not.toContain('wallet_connect');
    });
});

describe('capability table', () => {
    it('marks the wallets that reject signMessage at runtime', async () => {
        const { capabilitiesFor } = await import('../src/lib/wallet/capabilities');

        // Verified against the kit's module sources: both throw code -3.
        expect(capabilitiesFor('albedo').signMessage).toBe(false);
        expect(capabilitiesFor('rabet').signMessage).toBe(false);

        for (const id of ['freighter', 'xbull', 'lobstr', 'hana', 'klever', 'onekey']) {
            expect(capabilitiesFor(id).signMessage, id).toBe(true);
        }
    });

    it('treats every wallet as able to sign transactions', async () => {
        const { capabilitiesFor } = await import('../src/lib/wallet/capabilities');
        for (const id of ['albedo', 'rabet', 'freighter']) {
            expect(capabilitiesFor(id).signTransaction, id).toBe(true);
        }
    });

    it('assumes an unknown wallet is capable rather than broken', async () => {
        // A wallet added by a future kit release should work by default; the
        // cost of guessing wrong is an error at signing time, not a wallet we
        // refuse to offer for no reason.
        const { capabilitiesFor } = await import('../src/lib/wallet/capabilities');
        expect(capabilitiesFor('some-new-wallet-2027')).toEqual({
            signTransaction: true,
            signMessage: true,
        });
    });
});

describe('connect', () => {
    it('opens the selection modal and reports the chosen wallet', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.selectedModule = { productId: 'xbull' };

        const connected = await stellarKitAdapter.connect();

        expect(kitMock.authModal).toHaveBeenCalledTimes(1);
        expect(connected).toEqual({
            address: 'GADDRESS',
            walletId: 'xbull',
            walletName: 'xBull',
            capabilities: { signTransaction: true, signMessage: true },
        });
    });

    it('themes the modal instead of shipping the kit default', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        await stellarKitAdapter.connect();

        expect(kitMock.setTheme).toHaveBeenCalledTimes(1);
        const theme = kitMock.setTheme.mock.calls[0][0] as Record<string, string>;
        expect(theme['font-family']).toContain('--font-sans');
    });

    it('persists the chosen wallet so the next visit can restore it', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.selectedModule = { productId: 'lobstr' };

        await stellarKitAdapter.connect();

        expect(window.localStorage.getItem('acredia.wallet.selectedId')).toBe('lobstr');
    });

    it('reports a dismissed modal as a user rejection, not a failure', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        const { WalletUserRejectedError } = await import('../src/lib/wallet/types');
        kitMock.authModal.mockRejectedValueOnce({
            code: -4,
            message: 'The user closed the modal.',
        });

        await expect(stellarKitAdapter.connect()).rejects.toBeInstanceOf(WalletUserRejectedError);
    });
});

describe('restore', () => {
    it('never prompts the wallet on page load', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        window.localStorage.setItem('acredia.wallet.selectedId', 'freighter');

        await stellarKitAdapter.restore();

        // The whole point: reading an already-granted permission, never
        // requesting one. fetchAddress/authModal both raise popups.
        expect(kitMock.getAddress).toHaveBeenCalledTimes(1);
        expect(kitMock.fetchAddress).not.toHaveBeenCalled();
        expect(kitMock.authModal).not.toHaveBeenCalled();
    });

    it('clears a disabled HOT selection without loading the kit', async () => {
        window.localStorage.setItem('acredia.wallet.selectedId', 'hot-wallet');
        const { stellarKitAdapter } = await loadAdapter();
        expect(await stellarKitAdapter.restore()).toBeNull();
        expect(window.localStorage.getItem('acredia.wallet.selectedId')).toBeNull();
        expect(kitMock.init).not.toHaveBeenCalled();
    });

    it('does not even load the kit when no wallet was remembered', async () => {
        const { stellarKitAdapter } = await loadAdapter();

        expect(await stellarKitAdapter.restore()).toBeNull();
        expect(kitMock.init).not.toHaveBeenCalled();
    });

    it('stays disconnected when the cached session is missing', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        window.localStorage.setItem('acredia.wallet.selectedId', 'freighter');
        kitMock.getAddress.mockRejectedValueOnce(new Error('Wallet is locked'));

        expect(await stellarKitAdapter.restore()).toBeNull();
    });

    it('restores the remembered wallet with its capabilities', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        window.localStorage.setItem('acredia.wallet.selectedId', 'rabet');

        const restored = await stellarKitAdapter.restore();

        expect(kitMock.setWallet).toHaveBeenCalledWith('rabet');
        expect(restored).toMatchObject({
            walletId: 'rabet',
            walletName: 'Rabet',
            capabilities: { signTransaction: true, signMessage: false },
        });
    });
});

describe('signTransaction', () => {
    it.each(['freighter', 'xbull', 'hana'])(
        'refreshes the selected %s account before signing',
        async (id) => {
            const { stellarKitAdapter } = await loadAdapter();
            kitMock.selectedModule = { productId: id };
            await stellarKitAdapter.signTransaction('RAW_XDR', {
                networkPassphrase: TESTNET_PASSPHRASE,
                address: 'GSIGNER',
            });
            expect(kitMock.fetchAddress).toHaveBeenCalledOnce();
            expect(kitMock.fetchAddress.mock.invocationCallOrder[0]).toBeLessThan(
                kitMock.signTransaction.mock.invocationCallOrder[0],
            );
        },
    );

    it('rejects a changed account before requesting a transaction signature', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.fetchAddress.mockResolvedValueOnce({ address: 'GOTHER' });
        await expect(
            stellarKitAdapter.signTransaction('RAW_XDR', {
                networkPassphrase: TESTNET_PASSPHRASE,
                address: 'GSIGNER',
            }),
        ).rejects.toThrow(/account changed/i);
        expect(kitMock.signTransaction).not.toHaveBeenCalled();
    });

    it('rejects revoked permission before requesting a signature', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.fetchAddress.mockRejectedValueOnce(new Error('Permission revoked'));
        await expect(
            stellarKitAdapter.signTransaction('RAW_XDR', {
                networkPassphrase: TESTNET_PASSPHRASE,
                address: 'GSIGNER',
            }),
        ).rejects.toThrow(/Permission revoked/);
        expect(kitMock.signTransaction).not.toHaveBeenCalled();
    });
    it('returns the signed XDR string every wallet is normalised to', async () => {
        const { stellarKitAdapter } = await loadAdapter();

        const signed = await stellarKitAdapter.signTransaction('RAW_XDR', {
            networkPassphrase: 'Test SDF Network ; September 2015',
            address: 'GSIGNER',
        });

        expect(signed).toBe('SIGNED_XDR');
        expect(kitMock.signTransaction).toHaveBeenCalledWith('RAW_XDR', {
            networkPassphrase: 'Test SDF Network ; September 2015',
            address: 'GSIGNER',
        });
    });

    it('fails loudly rather than returning an empty signature', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.signTransaction.mockResolvedValueOnce({ signedTxXdr: '' });

        await expect(
            stellarKitAdapter.signTransaction('RAW_XDR', {
                networkPassphrase: 'Test SDF Network ; September 2015',
                address: 'GSIGNER',
            }),
        ).rejects.toThrow(/no signed transaction/i);
    });

    it('maps a wallet cancellation to a user rejection', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        const { WalletUserRejectedError } = await import('../src/lib/wallet/types');
        kitMock.signTransaction.mockRejectedValueOnce(new Error('User declined the request'));

        await expect(
            stellarKitAdapter.signTransaction('RAW_XDR', {
                networkPassphrase: 'Test SDF Network ; September 2015',
                address: 'GSIGNER',
            }),
        ).rejects.toBeInstanceOf(WalletUserRejectedError);
    });
});

describe('signMessage', () => {
    const opts = {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: 'GSIGNER',
    };

    it('refuses before calling a wallet that cannot sign messages', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        const { WalletCapabilityError } = await import('../src/lib/wallet/types');
        kitMock.selectedModule = { productId: 'albedo' };

        const error = await stellarKitAdapter.signMessage('hello', opts).catch((e) => e);

        expect(error).toBeInstanceOf(WalletCapabilityError);
        expect(error.walletName).toBe('Albedo');
        // Not attempted: the point is a clear message, not an opaque -3.
        expect(kitMock.signMessage).not.toHaveBeenCalled();
    });

    it('translates the kit’s -3 "not supported" into a capability error', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        const { WalletCapabilityError } = await import('../src/lib/wallet/types');
        // A wallet not in our table that still rejects as unsupported.
        kitMock.selectedModule = { productId: 'future-wallet' };
        kitMock.signMessage.mockRejectedValueOnce({
            code: -3,
            message: 'Not supported',
        });

        await expect(stellarKitAdapter.signMessage('hello', opts)).rejects.toBeInstanceOf(
            WalletCapabilityError,
        );
    });

    it('returns the signature for a capable wallet', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        kitMock.selectedModule = { productId: 'freighter' };

        expect(await stellarKitAdapter.signMessage('hello', opts)).toBe('c2lnbmF0dXJl');
    });
});

describe('network selection', () => {
    it('follows activeNetwork rather than hardcoding testnet', async () => {
        vi.resetModules();
        installMocks('Public Global Stellar Network ; September 2015');

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await stellarKitAdapter.connect();

        expect(kitMock.init).toHaveBeenCalledWith(
            expect.objectContaining({
                network: 'Public Global Stellar Network ; September 2015',
            }),
        );
    });

    it('rejects an unrecognised passphrase before initializing the kit', async () => {
        vi.resetModules();
        installMocks('Some Private Chain ; 2026');

        const { stellarKitAdapter } = await import('../src/lib/wallet/adapter');
        await expect(stellarKitAdapter.connect()).rejects.toThrow(/network is not supported/i);
        expect(kitMock.init).not.toHaveBeenCalled();
    });
});

describe('kit lifecycle', () => {
    it('initialises once even under concurrent callers', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        window.localStorage.setItem('acredia.wallet.selectedId', 'freighter');

        // A restore on mount racing a click on Connect must not init twice —
        // the kit's API is static, and a second init resets the selection.
        await Promise.all([
            stellarKitAdapter.restore(),
            stellarKitAdapter.connect(),
            stellarKitAdapter.listWallets(),
        ]);

        expect(kitMock.init).toHaveBeenCalledTimes(1);
    });

    it('clears the remembered wallet on disconnect', async () => {
        const { stellarKitAdapter } = await loadAdapter();
        window.localStorage.setItem('acredia.wallet.selectedId', 'freighter');

        await stellarKitAdapter.restore();
        await stellarKitAdapter.disconnect();

        expect(window.localStorage.getItem('acredia.wallet.selectedId')).toBeNull();
        expect(kitMock.disconnect).toHaveBeenCalled();
    });

    it('does not load the kit merely to disconnect', async () => {
        const { stellarKitAdapter } = await loadAdapter();

        await stellarKitAdapter.disconnect();

        expect(kitMock.init).not.toHaveBeenCalled();
    });

    it('lists wallets with availability resolved', async () => {
        const { stellarKitAdapter } = await loadAdapter();

        expect(await stellarKitAdapter.listWallets()).toEqual([
            { id: 'freighter', name: 'Freighter', isAvailable: true },
            { id: 'rabet', name: 'Rabet', isAvailable: false },
        ]);
    });
});
