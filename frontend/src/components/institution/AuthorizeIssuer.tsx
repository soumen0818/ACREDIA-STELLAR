'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authorizeIssuer, getContractOwner, isAuthorizedIssuer } from '@/lib/contracts';
import { debugLog, debugWarn, captureException } from '@/lib/debug';
import { safeGetSession } from '@/lib/supabase';
import { useStellarAccount } from '@/contexts/StellarContext';
import {
    WalletNetworkMismatchError,
    WalletUserRejectedError,
    WALLET_MESSAGES,
} from '@/lib/wallet/types';
import { activeNetwork } from '@/lib/stellar';

export function AuthorizeIssuer() {
    const { address, signer } = useStellarAccount();
    const [walletToAuthorize, setWalletToAuthorize] = useState('');
    const [isAuthorizing, setIsAuthorizing] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [contractOwner, setContractOwner] = useState('');

    useEffect(() => {
        const loadOwner = async () => {
            if (!address) return;

            try {
                const owner = await getContractOwner(address);
                setContractOwner(owner);
            } catch (error) {
                captureException(error, { context: 'loadOwner' });
            }
        };

        if (address) {
            loadOwner();
        }
    }, [address]);

    const checkAuthorization = async (addressToCheck = walletToAuthorize) => {
        if (!addressToCheck) {
            toast.error('Please enter a wallet address');
            return;
        }

        setIsChecking(true);
        try {
            const isInMapping = await isAuthorizedIssuer(addressToCheck, address || '');
            const isOwner = addressToCheck.toLowerCase() === contractOwner?.toLowerCase();
            const isAuthorizedResult = isInMapping || isOwner;

            setIsAuthorized(isAuthorizedResult);

            if (!isAuthorizedResult) {
                toast.warning('Wallet is not authorized');
                return;
            }

            if (isOwner) {
                toast.success('Authorized as Contract Owner');
            } else {
                toast.success('Wallet is authorized');
            }
        } catch (error) {
            captureException(error, { context: 'checkAuthorization' });
            toast.error('Failed to check authorization');
        } finally {
            setIsChecking(false);
        }
    };

    const handleAuthorizeWallet = async () => {
        if (!address) {
            toast.error('Please connect your wallet first');
            return;
        }

        if (!walletToAuthorize) {
            toast.error('Please enter a wallet address to authorize');
            return;
        }

        if (address.toLowerCase() !== contractOwner?.toLowerCase()) {
            toast.error('Only the contract owner can authorize wallets');
            return;
        }

        setIsAuthorizing(true);
        try {
            toast.loading('Preparing transaction...', { id: 'authorize' });

            if (!contractOwner) {
                toast.error('Contract owner not established', { id: 'authorize' });
                return;
            }

            if (!signer) {
                toast.error('Connect your wallet to authorize', { id: 'authorize' });
                return;
            }

            const hash = await authorizeIssuer(signer, walletToAuthorize);
            toast.success('Wallet authorized successfully!', { id: 'authorize' });
            toast.success(`Transaction: ${hash.slice(0, 10)}...`);

            try {
                const {
                    data: { session },
                } = await safeGetSession();

                if (!session?.access_token) {
                    throw new Error('Missing session token');
                }

                const response = await fetch('/api/admin/update-authorization', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        walletAddress: walletToAuthorize,
                        transactionHash: hash,
                    }),
                });

                const data = await response.json();
                if (data.success) {
                    debugLog('Issuer authorization synced to the database.');
                } else {
                    throw new Error(
                        data.error ||
                            'Authorization transaction could not be verified by the server.',
                    );
                }
            } catch (error) {
                debugWarn('Failed to sync issuer authorization to the database.', error);
                toast.warning(
                    `Wallet authorized on-chain, but database sync failed: ${
                        error instanceof Error ? (error instanceof Error ? error.message : String(error)) : 'Unknown error'
                    }`,
                );
            }

            await checkAuthorization(walletToAuthorize);
        } catch (error: unknown) {
            captureException(error, { context: 'handleAuthorizeWallet' });
            let msg: string;
            if (error instanceof WalletUserRejectedError) {
                msg = WALLET_MESSAGES.canceled;
            } else if (error instanceof WalletNetworkMismatchError) {
                msg = WALLET_MESSAGES.networkMismatch(error.expected || activeNetwork.networkName);
            } else {
                msg = (error instanceof Error ? error.message : String(error)) || 'Failed to authorize wallet';
            }
            toast.error(msg, { id: 'authorize' });
        } finally {
            setIsAuthorizing(false);
        }
    };

    const checkMyWallet = () => {
        if (!address) {
            return;
        }

        setWalletToAuthorize(address);
        checkAuthorization(address);
    };

    return (
        <Card className="p-6">
            <div className="mb-4 flex items-center space-x-3">
                <Shield className="h-6 w-6 text-primary" />
                <h2 className="text-2xl font-bold text-foreground">Authorize Issuer</h2>
            </div>

            <p className="mb-6 text-muted-foreground">
                Only authorized wallets can issue credentials. Use the contract owner wallet to
                authorize other wallets.
            </p>

            {contractOwner && (
                <div className="mb-4 rounded-lg border border-info/25 bg-info/8 p-4">
                    <p className="mb-1 text-sm font-medium text-foreground">Contract Owner Address</p>
                    <p className="break-all text-xs font-mono text-muted-foreground">{contractOwner}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Only this wallet can authorize other institutions
                    </p>
                </div>
            )}

            <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <p className="mb-1 text-sm font-medium text-foreground">
                            Your Connected Wallet
                        </p>
                        <p className="break-all text-xs font-mono text-muted-foreground">
                            {address || 'Not connected'}
                        </p>
                        {address &&
                            contractOwner &&
                            address.toLowerCase() === contractOwner.toLowerCase() && (
                                <p className="mt-2 text-xs font-medium text-success">
                                    You are the contract owner and can authorize other wallets.
                                </p>
                            )}
                    </div>
                    <Button
                        onClick={checkMyWallet}
                        variant="outline"
                        size="sm"
                        disabled={!address || isChecking}
                        className="ml-2"
                    >
                        {isChecking ? 'Checking...' : 'Check Status'}
                    </Button>
                </div>

                {isAuthorized !== null && (
                    <div className="mt-3 flex items-center space-x-2">
                        {isAuthorized ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 text-success" />
                                <span className="text-sm font-medium text-success">
                                    Authorized to issue credentials
                                </span>
                            </>
                        ) : (
                            <>
                                <Shield className="h-5 w-5 text-warning" />
                                <span className="text-sm font-medium text-warning">
                                    Not authorized - approval required
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div>
                    <Label htmlFor="walletAddress">Wallet Address to Authorize</Label>
                    <Input
                        id="walletAddress"
                        placeholder="G..."
                        value={walletToAuthorize}
                        onChange={(event) => setWalletToAuthorize(event.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        Enter the Stellar public key (`G...`) that should be authorized to issue
                        credentials
                    </p>
                </div>

                <div className="flex space-x-3">
                    <Button
                        onClick={handleAuthorizeWallet}
                        disabled={
                            isAuthorizing ||
                            !walletToAuthorize ||
                            !address ||
                            address.toLowerCase() !== contractOwner?.toLowerCase()
                        }
                        className="flex-1"
                    >
                        {isAuthorizing ? 'Authorizing...' : 'Authorize Wallet'}
                    </Button>

                    <Button
                        onClick={() => checkAuthorization(walletToAuthorize)}
                        disabled={isChecking || !walletToAuthorize}
                        variant="outline"
                    >
                        {isChecking ? 'Checking...' : 'Check Status'}
                    </Button>
                </div>
            </div>

            <div className="mt-6 rounded-lg border border-border bg-secondary/40 p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Important:</h3>
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    <li>
                        You must be the <strong>contract owner</strong> to authorize other wallets
                    </li>
                    <li>Contract owner: the wallet that deployed the CredentialNFT contract</li>
                    <li>After authorization, the wallet can issue credentials immediately</li>
                    <li>You can authorize multiple institution wallets</li>
                </ul>
            </div>
        </Card>
    );
}
