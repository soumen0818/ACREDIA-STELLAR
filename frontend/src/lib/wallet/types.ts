/**
 * The wallet boundary (ACREDIA-STELLAR#3, consumed by #272).
 *
 * Everything in the app that needs a wallet talks to this interface. Exactly
 * one module — `src/lib/wallet/adapter.ts` — implements it against a concrete
 * wallet library, so swapping or adding wallet support is a change in one
 * file rather than a rewrite scattered across contexts, contract calls and
 * page components.
 *
 * That boundary is enforced by lint: `@creit.tech/stellar-wallets-kit` and
 * `@stellar/freighter-api` are both banned imports everywhere except the
 * adapter (see eslint.config.mjs).
 */

/** A wallet the user can pick, as presented in the selection modal. */
export interface WalletOption {
    /** Stable id from the underlying kit (e.g. `freighter`, `xbull`). */
    id: string;
    name: string;
    /** False when the extension is not installed / the bridge is unreachable. */
    isAvailable: boolean;
}

/**
 * What a given wallet can actually do.
 *
 * Not every Stellar wallet implements every operation — Albedo and Rabet both
 * reject `signMessage` outright — and the claim flow is built entirely on
 * message signing. Capability is therefore something callers must be able to
 * ask about *before* sending the user down a path that will dead-end.
 */
export interface WalletCapabilities {
    signTransaction: boolean;
    signMessage: boolean;
}

/** The currently connected wallet, or null when nothing is connected. */
export interface ConnectedWallet {
    address: string;
    walletId: string;
    walletName: string;
    capabilities: WalletCapabilities;
}

export interface SignTransactionOptions {
    networkPassphrase: string;
    /** The address expected to sign; wallets use it to pick the right account. */
    address: string;
}

export interface SignMessageOptions {
    networkPassphrase: string;
    address: string;
}

/**
 * Raised when a caller asks a wallet for something it cannot do.
 *
 * Distinct from a signing failure: nothing went wrong, this wallet simply
 * does not implement the operation, and the fix is to use a different wallet
 * rather than to retry.
 */
export class WalletCapabilityError extends Error {
    readonly walletName: string;
    readonly capability: keyof WalletCapabilities;

    constructor(walletName: string, capability: keyof WalletCapabilities) {
        super(`${walletName} does not support ${capability}.`);
        this.name = 'WalletCapabilityError';
        this.walletName = walletName;
        this.capability = capability;
    }
}

/** Raised when the user dismisses a wallet prompt. Not an error state to report loudly. */
export class WalletUserRejectedError extends Error {
    constructor(message = 'Request was canceled in the wallet.') {
        super(message);
        this.name = 'WalletUserRejectedError';
    }
}

/**
 * Raised before a signature is requested when the wallet reports being on a
 * different network than the app expects (Issue #309).
 *
 * Distinct from a signing error: nothing went wrong yet — the wallet simply
 * isn't pointed at the right ledger. The fix is to change the wallet's
 * network setting, not to retry.
 */
export class WalletNetworkMismatchError extends Error {
    readonly expected: string;
    readonly actual: string | null;

    constructor(expected: string, actual: string | null = null, message?: string) {
        const actualPart = actual ? `\nWallet is on: ${actual}` : '';
        const defaultMsg = `Network mismatch: your wallet is on the wrong network.\nExpected: ${expected}${actualPart}\n\nSwitch your wallet to "${expected}" and try again.`;
        super(message ?? defaultMsg);
        this.name = 'WalletNetworkMismatchError';
        this.expected = expected;
        this.actual = actual;
    }
}

/**
 * User-facing messages for wallet error states.
 *
 * Single source of truth: contracts.ts and all components branch on
 * `instanceof` and read messages from here — no string matching anywhere
 * (Issue #309).
 */
export const WALLET_MESSAGES = {
    userCanceled: 'Transaction signing was canceled by the user.',
    canceled: 'Transaction was canceled.',
    networkMismatch: (expected: string) =>
        `Network mismatch: your wallet is on the wrong network. Expected: ${expected}. Please switch your wallet network and try again.`,
    signingFailed: (detail: string) => `Signing error: ${detail}`,
} as const;

/**
 * Detects whether an untyped error string specifically indicates a network mismatch,
 * while strictly excluding general connection/fetch errors (Issue #309).
 */
export function isNetworkMismatchError(message: string): boolean {
    const lower = message.toLowerCase();
    // Exclude connection / network transport errors
    if (
        /network\s*(?:request\s*failed|error|timeout|offline)/i.test(lower) ||
        /(?:failed\s+to\s+fetch|connection\s+(?:error|refused|failed|lost)|socket|econnrefused|err_)/i.test(
            lower,
        )
    ) {
        return false;
    }
    // Match explicit network mismatch phrasing
    return /(?:wrong\s+network|network\s+mismatch|different\s+network|passphrase\s+mismatch|invalid\s+network|switch\s+network)/i.test(
        lower,
    );
}

/**
 * The operations Acredia needs from a wallet.
 *
 * Deliberately narrow: `signAuthEntry`, fee-bump helpers and the kit's
 * submit-on-your-behalf path are all omitted because nothing here uses them,
 * and an unused method is a surface that silently rots.
 */
export interface WalletAdapter {
    /**
     * Opens wallet selection and connects to the user's choice.
     * Always driven by an explicit user action — never called on page load.
     */
    connect(): Promise<ConnectedWallet>;

    /**
     * Restores a previously-chosen wallet without prompting.
     *
     * Returns null when there is nothing to restore. This must never open a
     * wallet popup: it runs on page load, and a popup with no user gesture
     * behind it is both hostile and commonly blocked.
     */
    restore(): Promise<ConnectedWallet | null>;

    disconnect(): Promise<void>;

    /** Signs a base64 transaction XDR, returning the signed XDR. */
    signTransaction(xdr: string, options: SignTransactionOptions): Promise<string>;

    /** Signs a UTF-8 message, returning a base64 signature. */
    signMessage(message: string, options: SignMessageOptions): Promise<string>;

    /** Wallets offered in the selection modal, with availability resolved. */
    listWallets(): Promise<WalletOption[]>;

    /** What the given wallet can do. Answerable without connecting to it. */
    capabilitiesOf(walletId: string): WalletCapabilities;
}
