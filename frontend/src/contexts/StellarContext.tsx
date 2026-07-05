'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { isConnected, requestAccess, setAllowed } from '@stellar/freighter-api';
import { toast } from 'sonner';

import { captureException } from '@/lib/debug';

interface StellarContextType {
    address: string | null;
    isConnecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
}

const StellarContext = createContext<StellarContextType>({
    address: null,
    isConnecting: false,
    connect: async () => {},
    disconnect: () => {},
});

export const StellarProvider = ({ children }: { children: React.ReactNode }) => {
    const [address, setAddress] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkConnection = async () => {
            try {
                if (await isConnected()) {
                    const access = await requestAccess();
                    if (access && access.address) {
                        setAddress(access.address);
                        setError(null);
                    }
                }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
                // Ignore silently, wallet just not unlocked/connected
            }
        };
        checkConnection();
    }, []);

    const connect = async () => {
        setIsConnecting(true);
        setError(null);
        try {
            const connected = await isConnected();
            if (!connected) {
                const msg = 'Freighter wallet not detected. Please install the browser extension!';
                setError(msg);
                toast.error(msg);
                setIsConnecting(false);
                return;
            }

            await setAllowed();
            const access = await requestAccess();
            if (access && access.address) {
                setAddress(access.address);
                setError(null);
                toast.success('Wallet connected!');
            }
        } catch (error: unknown) {
            captureException(error, { context: 'connectFreighter' });
            let msg = (error instanceof Error ? error.message : String(error)) || 'Connection refused';
            // Detect user cancellation
            if (msg.includes('User canceled') || msg.includes('canceled')) {
                msg = 'Connection canceled by user';
            } else if (msg.includes('not installed')) {
                msg = 'Freighter wallet not found. Please install it first.';
            }
            setError(msg);
            toast.error(msg);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = () => {
        setAddress(null);
        setError(null);
        toast.info('Wallet disconnected from app level.');
    };

    return (
        <StellarContext.Provider value={{ address, isConnecting, connect, disconnect }}>
            {children}
        </StellarContext.Provider>
    );
};

export const useStellarAccount = () => useContext(StellarContext);
