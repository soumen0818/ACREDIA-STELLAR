'use client';

import { useStellarAccount } from '@/contexts/StellarContext';
import { Button } from './button';
import { Wallet, Copy, LogOut } from 'lucide-react';

import { toast } from 'sonner';

export function ConnectWallet() {
    const { address, isConnecting, connect, disconnect } = useStellarAccount();

    if (address) {
        return (
            <div className="flex items-center rounded-md border border-teal-600 bg-white shadow-sm overflow-hidden h-10">
                <Button
                    variant="ghost"
                    className="rounded-none border-r border-teal-200 text-teal-700 hover:bg-teal-50 h-full px-3 font-mono text-sm"
                    onClick={() => {
                        navigator.clipboard.writeText(address);
                        toast.success('Wallet address copied!');
                    }}
                    title="Copy Address"
                    aria-label={`Wallet connected: ${address.slice(0, 5)}...${address.slice(-4)}. Click to copy full address.`}
                >
                    <Wallet className="h-4 w-4 mr-2 text-teal-600" />
                    {address.slice(0, 5)}...{address.slice(-4)}
                    <Copy className="h-3 w-3 ml-2 text-teal-400 opacity-70" />
                </Button>
                <Button
                    onClick={disconnect}
                    variant="ghost"
                    className="rounded-none text-red-500 hover:text-red-700 hover:bg-red-50 h-full px-3"
                    title="Disconnect Wallet"
                    aria-label="Disconnect wallet"
                >
                    <LogOut className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <Button
            onClick={connect}
            disabled={isConnecting}
            className="bg-linear-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-700 hover:to-cyan-700 transition-all shadow-md"
            aria-label={
                isConnecting ? 'Connecting wallet...' : 'Connect Stellar wallet with Freighter'
            }
        >
            <Wallet className="h-4 w-4 mr-2" />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </Button>
    );
}
