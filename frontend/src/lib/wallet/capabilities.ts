import type { WalletCapabilities } from './types';

/**
 * Which wallets can do what.
 *
 * Every wallet the kit exposes declares `signMessage` in its TypeScript
 * types, so the type system is no help here — the difference only shows at
 * runtime, where Albedo and Rabet both reject the call:
 *
 *     // albedo.module.js
 *     async signMessage() { throw { code: -3, message: 'Albedo does not
 *       support the "signMessage" function' }; }
 *
 *     // rabet.module.js
 *     signMessage() { return Promise.reject({ code: -3, message: 'Rabet does
 *       not support the "signMessage" function' }); }
 *
 * The claim flow (`/claim`) is built entirely on message signing, so a student
 * who picks one of those two would connect successfully and then hit a dead
 * end at the final step. This table is what lets the UI keep them out of that
 * path in the first place.
 *
 * Verified against @creit.tech/stellar-wallets-kit 2.7.0. When bumping the
 * kit, re-check the module sources — a wallet gaining `signMessage` is a
 * silent capability change here, not a type error.
 */

export const WALLET_IDS = {
    FREIGHTER: 'freighter',
    XBULL: 'xbull',
    ALBEDO: 'albedo',
    RABET: 'rabet',
    LOBSTR: 'lobstr',
    HANA: 'hana',
    HOT_WALLET: 'hot-wallet',
    KLEVER: 'klever',
    ONEKEY: 'onekey',
    BITGET: 'BitgetWallet',
    WALLET_CONNECT: 'wallet_connect',
} as const;

/**
 * Wallet ids that reject `signMessage` at runtime despite typing it.
 *
 * WalletConnect is deliberately absent: it requests `stellar_signMessage` as an
 * optional namespace, so whether it works depends on the wallet app the student
 * scans with rather than on the transport. Treating it as capable is what lets a
 * phone reach `/claim` at all (ACREDIA-STELLAR#4); a wallet app that declines
 * the method surfaces as the kit's -3 rejection, which the adapter already maps
 * back to a capability error naming the wallet.
 */
const NO_MESSAGE_SIGNING: ReadonlySet<string> = new Set([
    WALLET_IDS.ALBEDO,
    WALLET_IDS.RABET,
    WALLET_IDS.HOT_WALLET,
]);

/**
 * Capabilities for a wallet id.
 *
 * Unknown ids are assumed fully capable rather than assumed broken: a new
 * wallet appearing after a kit upgrade should work by default, and the
 * failure mode for guessing wrong is an error at signing time — the same
 * error the user would have got anyway — rather than a wallet we refuse to
 * offer for no reason.
 */
export function capabilitiesFor(walletId: string): WalletCapabilities {
    return {
        signTransaction: walletId !== WALLET_IDS.HOT_WALLET,
        signMessage: !NO_MESSAGE_SIGNING.has(walletId),
    };
}

/** True when this wallet can complete the `/claim` ownership proof. */
export function supportsMessageSigning(walletId: string): boolean {
    return capabilitiesFor(walletId).signMessage;
}
