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

export function AuthorizeIssuer() {
    const { address } = useStellarAccount();
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

            const hash = await authorizeIssuer(address, walletToAuthorize);
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
            let msg = (error instanceof Error ? error.message : String(error)) || 'Failed to authorize wallet';
            if (msg.includes('canceled') || msg.includes('User')) {
                msg = 'Authorization transaction was canceled.';
            } else if (msg.includes('Network')) {
                msg = 'Network mismatch detected. Please check your Freighter settings.';
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
        <Card className="border-gray-200 bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center space-x-3">
                <Shield className="h-6 w-6 text-teal-600" />
                <h2 className="text-2xl font-bold text-gray-900">Authorize Issuer</h2>
            </div>

            <p className="mb-6 text-gray-600">
                Only authorized wallets can issue credentials. Use the contract owner wallet to
                authorize other wallets.
            </p>

            {contractOwner && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="mb-1 text-sm font-medium text-blue-900">Contract Owner Address</p>
                    <p className="break-all text-xs font-mono text-blue-700">{contractOwner}</p>
                    <p className="mt-2 text-xs text-blue-600">
                        Only this wallet can authorize other institutions
                    </p>
                </div>
            )}

            <div className="mb-6 rounded-lg border border-teal-200 bg-teal-50 p-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <p className="mb-1 text-sm font-medium text-teal-900">
                            Your Connected Wallet
                        </p>
                        <p className="break-all text-xs font-mono text-teal-700">
                            {address || 'Not connected'}
                        </p>
                        {address &&
                            contractOwner &&
                            address.toLowerCase() === contractOwner.toLowerCase() && (
                                <p className="mt-2 text-xs font-medium text-green-600">
                                    You are the contract owner and can authorize other wallets.
                                </p>
                            )}
                    </div>
                    <Button
                        onClick={checkMyWallet}
                        variant="outline"
                        size="sm"
                        disabled={!address || isChecking}
                        className="ml-2 border-teal-600 text-teal-600 hover:bg-teal-50"
                    >
                        {isChecking ? 'Checking...' : 'Check Status'}
                    </Button>
                </div>

                {isAuthorized !== null && (
                    <div className="mt-3 flex items-center space-x-2">
                        {isAuthorized ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                <span className="text-sm font-medium text-green-700">
                                    Authorized to issue credentials
                                </span>
                            </>
                        ) : (
                            <>
                                <Shield className="h-5 w-5 text-orange-600" />
                                <span className="text-sm font-medium text-orange-700">
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
                    <p className="mt-1 text-xs text-gray-500">
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
                        className="flex-1 bg-linear-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-700 hover:to-cyan-700"
                    >
                        {isAuthorizing ? 'Authorizing...' : 'Authorize Wallet'}
                    </Button>

                    <Button
                        onClick={() => checkAuthorization(walletToAuthorize)}
                        disabled={isChecking || !walletToAuthorize}
                        variant="outline"
                        className="border-gray-300"
                    >
                        {isChecking ? 'Checking...' : 'Check Status'}
                    </Button>
                </div>
            </div>

            <div className="mt-6 rounded-lg bg-gray-50 p-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Important:</h3>
                <ul className="list-inside list-disc space-y-1 text-xs text-gray-600">
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
