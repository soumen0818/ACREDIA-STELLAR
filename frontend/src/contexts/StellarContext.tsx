'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { toast } from 'sonner';

import { captureException } from '@/lib/debug';
import { getE2eState } from '@/lib/e2e';
import { createE2eSigner } from '@/lib/e2eLedger';
import type { StellarSigner } from '@/lib/stellarSigner';
import {
    WalletUserRejectedError,
    isMobileBrowser,
    isMobileCapable,
    capabilitiesFor,
    walletAdapter,
    type WalletCapabilities,
} from '@/lib/wallet';
import { createWalletSigner } from '@/lib/wallet/signer';

interface StellarContextType {
    address: string | null;
    /** Which wallet the user actually chose, for copy that used to say "Freighter". */
    walletId: string | null;
    walletName: string | null;
    /** What that wallet can do — notably whether `/claim` can use it. */
    capabilities: WalletCapabilities | null;
    /**
     * The connected wallet as a {@link StellarSigner}, or null when
     * disconnected (ACREDIA-STELLAR#3).
     *
     * Contract calls take this rather than a bare address. Built here so no
     * component has to assemble one, and so the E2E fake is substituted in
     * exactly one place instead of being branched on inside `contracts.ts`.
     */
    signer: StellarSigner | null;
    /**
     * Whether this is a phone (ACREDIA-STELLAR#4).
     *
     * Nine of the ten supported wallets are desktop browser extensions, so the
     * honest set of options differs by device. Resolved once here rather than
     * sniffed in each component, and after mount so server and client render
     * the same markup.
     */
    isMobile: boolean;
    /**
     * True when the device has no wallet it can actually use — a phone with
     * WalletConnect unconfigured. The UI explains the gap instead of opening a
     * modal listing extensions that cannot be installed there.
     */
    hasNoUsableWallet: boolean;
    /**
     * True when the device can connect a wallet but none of the reachable ones
     * can sign a *message*, which is the only thing `/claim` needs.
     *
     * Distinct from {@link hasNoUsableWallet} because it is a narrower failure:
     * on a phone with WalletConnect unconfigured, Albedo still connects and can
     * sign transactions — so the Connect button works — but a student cannot
     * prove wallet ownership and therefore cannot claim. Only `/claim` cares.
     */
    hasNoMessageSigningWallet: boolean;
    isConnecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
}

// No default value: a component outside the provider would otherwise see
// "no wallet connected" and give no sign that the provider is missing.
const StellarContext = createContext<StellarContextType | null>(null);

export const StellarProvider = ({ children }: { children: React.ReactNode }) => {
    const [address, setAddress] = useState<string | null>(null);
    const [walletId, setWalletId] = useState<string | null>(null);
    const [walletName, setWalletName] = useState<string | null>(null);
    const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    // Starts false and is resolved after mount: reading the user agent during
    // render would make the server and client markup disagree and trip
    // hydration. Until it resolves the UI shows the desktop path, which is the
    // less restrictive default.
    const [isMobile, setIsMobile] = useState(false);
    const [hasNoUsableWallet, setHasNoUsableWallet] = useState(false);
    const [hasNoMessageSigningWallet, setHasNoMessageSigningWallet] = useState(false);

    useEffect(() => {
        const mobile = isMobileBrowser();
        setIsMobile(mobile);

        if (!mobile) return;
        let cancelled = false;

        // On a phone, work out up front whether anything here can actually
        // connect. Nine of the ten wallets are desktop extensions, so without
        // WalletConnect configured the answer is no — and the user deserves to
        // be told that instead of tapping into a modal full of install links
        // for software that does not exist on their device.
        void (async () => {
            try {
                const wallets = await walletAdapter.listWallets();
                if (cancelled) return;

                const reachable = wallets.filter((wallet) => isMobileCapable(wallet.id));
                setHasNoUsableWallet(reachable.length === 0);

                // `/claim` proves ownership with a message signature. Albedo is
                // reachable on a phone but cannot sign messages, so "can
                // connect" and "can claim" are genuinely different answers here.
                setHasNoMessageSigningWallet(
                    !reachable.some((wallet) => capabilitiesFor(wallet.id).signMessage),
                );
            } catch {
                // Listing failed; leave the Connect button alone rather than
                // blocking it on a diagnostic that did not run.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        // Silently restore a previously-chosen wallet on load.
        //
        // IMPORTANT: `restore()` must never open a wallet popup. A prompt with
        // no user gesture behind it is hostile, is commonly blocked by the
        // browser, and for hardware wallets can leave a device waiting on
        // input nobody asked for. The adapter upholds this by reading the
        // already-granted permission rather than requesting access; keep any
        // change to that path under the same rule.
        const restore = async () => {
            try {
                const restored = await walletAdapter.restore();
                if (cancelled || !restored) return;

                setAddress(restored.address);
                setWalletId(restored.walletId);
                setWalletName(restored.walletName);
                setCapabilities(restored.capabilities);
            } catch {
                // Wallet locked, uninstalled, or permission revoked. Start
                // disconnected — the Connect button is right there.
            }
        };

        restore();
        return () => {
            cancelled = true;
        };
    }, []);

    const connect = useCallback(async () => {
        setIsConnecting(true);
        try {
            const connected = await walletAdapter.connect();
            setAddress(connected.address);
            setWalletId(connected.walletId);
            setWalletName(connected.walletName);
            setCapabilities(connected.capabilities);
            toast.success(`Connected with ${connected.walletName}`);
        } catch (error: unknown) {
            // A user closing the modal is a decision, not a fault. Reporting
            // it as an error trains people to distrust the error channel.
            if (error instanceof WalletUserRejectedError) {
                toast.info(error.message);
                return;
            }

            captureException(error, { context: 'connectWallet' });
            toast.error(
                (error instanceof Error ? error.message : String(error)) ||
                    'Could not connect your wallet.',
            );
        } finally {
            setIsConnecting(false);
        }
    }, []);

    const disconnect = useCallback(() => {
        void walletAdapter.disconnect();
        setAddress(null);
        setWalletId(null);
        setWalletName(null);
        setCapabilities(null);
        toast.info('Wallet disconnected from app level.');
    }, []);

    /**
     * The signer handed to contract calls.
     *
     * The E2E substitution happens here and nowhere else. `contracts.ts` used
     * to ask `getE2eState()` six separate times to work out whether it was
     * under test; now it only has to look at the signer it was given.
     */
    const signer = useMemo<StellarSigner | null>(() => {
        if (!address) return null;

        if (getE2eState()?.enabled) {
            return createE2eSigner(address);
        }

        return createWalletSigner(address, capabilities);
    }, [address, capabilities]);

    return (
        <StellarContext.Provider
            value={{
                address,
                walletId,
                walletName,
                capabilities,
                signer,
                isMobile,
                hasNoUsableWallet,
                hasNoMessageSigningWallet,
                isConnecting,
                connect,
                disconnect,
            }}
        >
            {children}
        </StellarContext.Provider>
    );
};

export const useStellarAccount = () => {
    const context = useContext(StellarContext);
    if (!context) {
        // Mounted by app/(console)/layout.tsx and app/claim/layout.tsx only,
        // so the wallet stack stays off every other page (review §4.1).
        throw new Error('useStellarAccount must be used within a StellarProvider');
    }
    return context;
};
