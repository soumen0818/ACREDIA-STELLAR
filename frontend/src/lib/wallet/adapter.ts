/**
 * The one module allowed to import a concrete wallet library.
 *
 * Implements {@link WalletAdapter} over Stellar Wallets Kit, which gives
 * Acredia Freighter, xBull, Albedo, Rabet, Lobstr, Hana, Klever, OneKey
 * and Bitget through a single API instead of the Freighter-only lock-in that
 * was an adoption ceiling for a product whose whole promise is universal,
 * lifelong access (ACREDIA-STELLAR#272).
 *
 * Everything else in the app imports {@link WalletAdapter} from `./types`.
 * Lint enforces that (see eslint.config.mjs): adding a second import site for
 * the kit is a build failure, not a review note.
 *
 * The kit is loaded lazily (dynamic `import()` inside {@link ensureInitialized})
 * rather than at module scope, for two reasons:
 *
 *  - It is a browser library. It pulls in Preact, WalletConnect and several
 *    hardware-wallet transports, and it touches `window` on import. A static
 *    import would drag all of that into every Node context that transitively
 *    reaches `contracts.ts` — which is most of the server-side unit suite.
 *  - None of it is needed until the user actually goes to use a wallet, so
 *    keeping it out of the initial bundle is the right default anyway.
 */

import { activeNetwork } from '@/lib/stellar';
import { debugWarn } from '@/lib/debug';
import { runtimeConfig } from '@/lib/runtimeConfig';
import { capabilitiesFor, WALLET_IDS } from './capabilities';
import { isMobileBrowser } from './platform';
import { ensureModalA11y } from './modalA11y';
import { buildWalletModalTheme } from './theme';
import {
    WalletCapabilityError,
    WalletUserRejectedError,
    type ConnectedWallet,
    type SignMessageOptions,
    type SignTransactionOptions,
    type WalletAdapter,
    type WalletOption,
} from './types';

/**
 * Where the user's wallet choice is remembered between visits.
 *
 * Acredia stores only the wallet id. The Kit also caches an address in its
 * own storage. Silent restore displays that cached session; signing explicitly
 * revalidates the selected account with the wallet before requesting a signature.
 */
const SELECTED_WALLET_STORAGE_KEY = 'acredia.wallet.selectedId';

/** Human-readable names, so no user-facing copy has to hardcode "Freighter". */
const WALLET_NAMES: Record<string, string> = {
    [WALLET_IDS.FREIGHTER]: 'Freighter',
    [WALLET_IDS.XBULL]: 'xBull',
    [WALLET_IDS.ALBEDO]: 'Albedo',
    [WALLET_IDS.RABET]: 'Rabet',
    [WALLET_IDS.LOBSTR]: 'Lobstr',
    [WALLET_IDS.HANA]: 'Hana',
    [WALLET_IDS.HOT_WALLET]: 'HOT Wallet',
    [WALLET_IDS.KLEVER]: 'Klever',
    [WALLET_IDS.ONEKEY]: 'OneKey',
    [WALLET_IDS.BITGET]: 'Bitget Wallet',
    // Named for what the student actually does, not for the protocol: on a
    // phone they scan a code with their wallet app (ACREDIA-STELLAR#4).
    [WALLET_IDS.WALLET_CONNECT]: 'Mobile wallet (scan QR)',
};

export function walletNameFor(walletId: string): string {
    return WALLET_NAMES[walletId] ?? walletId;
}

/**
 * The passphrases the kit's `Networks` enum covers.
 *
 * Restated as plain strings rather than imported, so this module can decide
 * the network without pulling the kit into scope. They are protocol
 * constants — they do not drift.
 */
const NETWORK_PASSPHRASES = {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
    FUTURENET: 'Test SDF Future Network ; October 2022',
    SANDBOX: 'Local Sandbox Stellar Network ; September 2022',
    STANDALONE: 'Standalone Network ; February 2017',
} as const;

/**
 * Translates the app's network selection into the kit's network value.
 *
 * Driven solely by `activeNetwork`, never hardcoded — a wallet kit pinned to
 * testnet while the app runs on mainnet would sign against the wrong ledger,
 * and the resulting "network mismatch" is the kind of error users blame on
 * their wallet rather than on us. Custom deployments map by passphrase so a
 * standalone/futurenet target still lands on the right value; an unrecognised passphrase is rejected before the Kit is initialized.
 */
function kitNetwork(): string {
    const passphrase = activeNetwork.networkPassphrase;
    const known = Object.values(NETWORK_PASSPHRASES) as readonly string[];
    if (!known.includes(passphrase))
        throw new Error('The configured Stellar network is not supported by the wallet adapter.');
    return passphrase;
}

function readStoredWalletId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(SELECTED_WALLET_STORAGE_KEY);
    } catch {
        // Private browsing / storage disabled. Not being able to remember the
        // choice is a smaller problem than refusing to connect at all.
        return null;
    }
}

function storeWalletId(walletId: string | null): void {
    if (typeof window === 'undefined') return;
    try {
        if (walletId) {
            window.localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, walletId);
        } else {
            window.localStorage.removeItem(SELECTED_WALLET_STORAGE_KEY);
        }
    } catch {
        // See readStoredWalletId.
    }
}

/** The subset of the kit's static API this adapter uses. */
type Kit = typeof import('@creit.tech/stellar-wallets-kit').StellarWalletsKit;

/**
 * In-flight or completed kit load.
 *
 * Held as the promise rather than the resolved value so two concurrent
 * callers (a restore on mount racing a click on Connect) share one load and
 * one `init` — the kit's API is static, and a second `init` would reset the
 * selected wallet out from under a live session.
 */
let kitPromise: Promise<Kit> | null = null;

/**
 * Builds the WalletConnect module, or null when it is not configured.
 *
 * This is the only wallet a phone can reach (ACREDIA-STELLAR#4): every other
 * supported wallet is a desktop browser extension, so without this the mobile
 * wallet list is effectively empty.
 *
 * The project id is deployment configuration rather than code, so its absence
 * is a normal state, not an error — the module is simply not registered, and
 * the UI explains the gap instead of listing a wallet that cannot connect.
 * Loaded separately from the others so its WalletConnect/Reown dependencies
 * stay out of the bundle entirely when unconfigured.
 */
async function loadWalletConnectModule() {
    const { projectId, appName, appUrl } = runtimeConfig.walletConnect;
    if (!projectId) return null;

    try {
        const { WalletConnectModule, WalletConnectTargetChain } =
            await import('@creit.tech/stellar-wallets-kit/modules/wallet-connect');

        // The module defaults `allowedChains` to PUBLIC. Leaving that alone on
        // a testnet deployment would ask the wallet to approve a mainnet
        // session, so the chain is derived from the app's own network — the
        // same rule as everywhere else: never a hardcoded network.
        const chain =
            kitNetwork() === NETWORK_PASSPHRASES.PUBLIC
                ? WalletConnectTargetChain.PUBLIC
                : WalletConnectTargetChain.TESTNET;

        return new WalletConnectModule({
            projectId,
            // Shown in the wallet while the student approves the session, so
            // these have to be the real app identity — a placeholder here reads
            // as phishing at the moment trust matters most.
            metadata: {
                name: appName,
                description: 'Blockchain academic credentials on Stellar',
                url: appUrl,
                icons: [`${appUrl.replace(/\/$/, '')}/logo.png`],
            },
            allowedChains: [chain],
        });
    } catch (error) {
        // A misconfigured project id must degrade to "no WalletConnect",
        // never to "the Connect button throws".
        debugWarn('WalletConnect could not be initialised.', error);
        return null;
    }
}

async function loadKit(): Promise<Kit> {
    const [
        { StellarWalletsKit },
        { FreighterModule },
        { xBullModule },
        { AlbedoModule },
        { RabetModule },
        { LobstrModule },
        { HanaModule },
        { KleverModule },
        { OneKeyModule },
        { BitgetModule },
    ] = await Promise.all([
        import('@creit.tech/stellar-wallets-kit'),
        // Per-wallet subpaths, so the wallets we do not register (Ledger,
        // Trezor, D'Cent, Scopuly…) never enter the bundle.
        import('@creit.tech/stellar-wallets-kit/modules/freighter'),
        import('@creit.tech/stellar-wallets-kit/modules/xbull'),
        import('@creit.tech/stellar-wallets-kit/modules/albedo'),
        import('@creit.tech/stellar-wallets-kit/modules/rabet'),
        import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
        import('@creit.tech/stellar-wallets-kit/modules/hana'),
        import('@creit.tech/stellar-wallets-kit/modules/klever'),
        import('@creit.tech/stellar-wallets-kit/modules/onekey'),
        import('@creit.tech/stellar-wallets-kit/modules/bitget'),
    ]);

    // Loaded after the others so an unconfigured/failed WalletConnect cannot
    // stop the extension wallets from being registered.
    const walletConnect = await loadWalletConnectModule();

    const mobile = isMobileBrowser();

    // Desktop extensions are not registered at all on a phone. Registering them
    // would fill the modal with rows reading "Install" beside wallets that
    // cannot be installed on that device — the dead end this issue is about,
    // just relocated into the modal (ACREDIA-STELLAR#4).
    const extensionModules = mobile
        ? []
        : [
              new FreighterModule(),
              new xBullModule(),
              new RabetModule(),
              new LobstrModule(),
              new HanaModule(),
              new KleverModule(),
              new OneKeyModule(),
              new BitgetModule(),
          ];

    const modules = [
        ...(walletConnect ? [walletConnect] : []),
        new AlbedoModule(),
        ...extensionModules,
    ];
    const storedId = readStoredWalletId();
    const selectedId = modules.some((module) => module.productId === storedId) ? storedId : null;
    if (storedId && !selectedId) storeWalletId(null);

    StellarWalletsKit.init({
        network: kitNetwork() as Parameters<typeof StellarWalletsKit.init>[0]['network'],
        selectedWalletId: selectedId ?? undefined,
        modules,
        authModal: {
            // On desktop, an unavailable wallet is shown with an install link so
            // "my wallet isn't listed" has an answer where the question occurs.
            // On mobile nothing in the list is installable, so the label would
            // be an instruction the device cannot follow.
            showInstallLabel: !mobile,
        },
    });

    return StellarWalletsKit;
}

/** Loads and initialises the kit, at most once per page. */
function kit(): Promise<Kit> {
    kitPromise ??= loadKit();
    return kitPromise;
}

/**
 * The kit reports user dismissal through a few different shapes depending on
 * which wallet raised it — an Error, or a `{ code, message }` object. Both
 * mean the same thing to us, and neither should surface as a red error toast.
 */
function isUserRejection(error: unknown): boolean {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null && 'message' in error
              ? String((error as { message: unknown }).message)
              : String(error);

    return /cancel|reject|denied|dismiss|closed by the user|user closed|user declined/i.test(
        message,
    );
}

/** The kit's capability rejections carry code -3. */
function isCapabilityRejection(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        return (error as { code: unknown }).code === -3;
    }
    return false;
}

function toMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/**
 * Reads back which wallet the kit has selected.
 *
 * Preferred over trusting our own stored id after a connect: the user may
 * have picked a different wallet in the modal than the one we restored.
 */
function selectedWalletId(activeKit: Kit): string {
    try {
        return activeKit.selectedModule?.productId ?? '';
    } catch {
        return '';
    }
}

/** Refresh permissions/account only during an explicit signing action. */
async function validateSigningAccount(activeKit: Kit, expectedAddress: string): Promise<void> {
    const { address } = await activeKit.fetchAddress();
    if (address !== expectedAddress) {
        throw new Error('Your wallet account changed. Reconnect your wallet before signing.');
    }
}

export const stellarKitAdapter: WalletAdapter = {
    async connect(): Promise<ConnectedWallet> {
        ensureModalA11y();
        const activeKit = await kit();
        activeKit.setTheme(buildWalletModalTheme());

        try {
            const { address } = await activeKit.authModal();
            const walletId = selectedWalletId(activeKit);
            storeWalletId(walletId || null);

            return {
                address,
                walletId,
                walletName: walletNameFor(walletId),
                capabilities: capabilitiesFor(walletId),
            };
        } catch (error) {
            if (isUserRejection(error)) {
                throw new WalletUserRejectedError('Wallet connection was canceled.');
            }
            throw new Error(toMessage(error), { cause: error });
        }
    },

    async restore(): Promise<ConnectedWallet | null> {
        const walletId = readStoredWalletId();
        // Nothing remembered means nothing to restore — and, importantly, no
        // reason to load the kit at all on a first visit.
        if (!walletId) return null;
        if (walletId === WALLET_IDS.HOT_WALLET) {
            storeWalletId(null);
            return null;
        }

        try {
            const activeKit = await kit();
            activeKit.setWallet(walletId);

            // The Kit reads its cached address only. This avoids unprompted
            // wallet popups; permission/account changes are checked at signing.
            const { address } = await activeKit.getAddress();
            if (!address) return null;

            return {
                address,
                walletId,
                walletName: walletNameFor(walletId),
                capabilities: capabilitiesFor(walletId),
            };
        } catch {
            // Invalid wallet id or missing cached session. Never prompt here.
            return null;
        }
    },

    async disconnect(): Promise<void> {
        storeWalletId(null);
        // Never load the kit just to tear down: if it was never loaded there
        // is no connection to close.
        if (!kitPromise) return;
        try {
            const activeKit = await kit();
            await activeKit.disconnect();
        } catch {
            // Already gone. The app-level state is cleared regardless.
        }
    },

    async signTransaction(xdr: string, options: SignTransactionOptions): Promise<string> {
        const activeKit = await kit();

        try {
            await validateSigningAccount(activeKit, options.address);
            const { signedTxXdr } = await activeKit.signTransaction(xdr, {
                networkPassphrase: options.networkPassphrase,
                address: options.address,
            });

            if (!signedTxXdr) {
                throw new Error('The wallet returned no signed transaction.');
            }

            return signedTxXdr;
        } catch (error) {
            if (isUserRejection(error)) {
                throw new WalletUserRejectedError('Transaction signing was canceled.');
            }
            throw new Error(toMessage(error), { cause: error });
        }
    },

    async signMessage(message: string, options: SignMessageOptions): Promise<string> {
        const activeKit = await kit();

        // Checked before calling, so an unsupported wallet produces a
        // capability error naming the wallet rather than whatever opaque
        // rejection that particular module happens to throw.
        const walletId = selectedWalletId(activeKit);
        if (!capabilitiesFor(walletId).signMessage) {
            throw new WalletCapabilityError(walletNameFor(walletId), 'signMessage');
        }

        try {
            await validateSigningAccount(activeKit, options.address);
            const { signedMessage } = await activeKit.signMessage(message, {
                networkPassphrase: options.networkPassphrase,
                address: options.address,
            });

            if (!signedMessage) {
                throw new Error('The wallet returned no signature.');
            }

            return signedMessage;
        } catch (error) {
            if (error instanceof WalletCapabilityError) throw error;
            // A wallet not in the capability table can still reject with the
            // kit's -3 "not supported" code; report that as a capability gap
            // too rather than as a signing failure the user could retry.
            if (isCapabilityRejection(error)) {
                throw new WalletCapabilityError(walletNameFor(walletId), 'signMessage');
            }
            if (isUserRejection(error)) {
                throw new WalletUserRejectedError('Message signing was canceled.');
            }
            throw new Error(toMessage(error), { cause: error });
        }
    },

    async listWallets(): Promise<WalletOption[]> {
        const activeKit = await kit();
        const supported = await activeKit.refreshSupportedWallets();
        return supported.map((wallet) => ({
            id: wallet.id,
            name: wallet.name,
            isAvailable: wallet.isAvailable,
        }));
    },

    capabilitiesOf(walletId: string) {
        return capabilitiesFor(walletId);
    },
};

/** Test seam: drops the memoised kit so suites start from a clean load. */
export function __resetAdapterForTests(): void {
    kitPromise = null;
}
