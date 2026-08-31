'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Wallet } from 'lucide-react';
import { signMessage } from '@stellar/freighter-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { cn } from '@/lib/utils';
import { getPasswordRequirements, getPasswordValidationError } from '@/lib/authFlow';
import { useStellarAccount } from '@/contexts/StellarContext';
import { captureException } from '@/lib/debug';
import { normalizeSignedMessage } from '@/lib/walletOwnership';
import { activeNetwork } from '@/lib/stellar';

type Step = 'connect' | 'details' | 'done';

/**
 * Wallet-ownership claim (Issue #243).
 *
 * A credential may be issued to a wallet address before that student has an
 * account, so this is how they get in when their institution never provisioned
 * one for them. They prove control of the wallet by signing a server-issued
 * challenge, then set an email and password.
 *
 * The email matters: it makes the account recoverable through the ordinary
 * password-reset flow, so losing the wallet does not lose the account. The
 * wallet proves ownership once; it is not the ongoing login credential.
 */
export default function ClaimPage() {
    const router = useRouter();
    const { address, connect, isConnecting } = useStellarAccount();

    const [step, setStep] = useState<Step>('connect');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const passwordRequirements = getPasswordRequirements(password);

    const handleConnect = async () => {
        setError('');
        try {
            await connect();
            setStep('details');
        } catch (err) {
            captureException(err, { context: 'claimConnectWallet' });
            setError('Could not connect your wallet. Make sure Freighter is installed and unlocked.');
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (!address) {
            setError('Connect your wallet first.');
            return;
        }

        const passwordError = getPasswordValidationError(password);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setSubmitting(true);

        try {
            // 1. Ask the server for a challenge. Never invent one client-side —
            //    the server only accepts a nonce it issued and stored itself.
            const nonceResponse = await fetch('/api/claim/nonce', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address }),
            });

            const noncePayload = await nonceResponse.json().catch(() => null);

            if (!nonceResponse.ok || !noncePayload?.success) {
                setError(noncePayload?.error || 'Could not start the claim. Try again.');
                return;
            }

            // 2. Sign it with the wallet.
            const signed = await signMessage(noncePayload.message, {
                address,
                networkPassphrase: activeNetwork.networkPassphrase,
            });

            if (signed.error) {
                setError('Wallet signature was declined or failed.');
                return;
            }

            const signature = normalizeSignedMessage(
                signed.signedMessage as string | Uint8Array | null,
            );

            if (!signature) {
                setError('Your wallet did not return a signature.');
                return;
            }

            // 3. The server verifies the signature and creates the account.
            const verifyResponse = await fetch('/api/claim/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    nonce: noncePayload.nonce,
                    signature,
                    email: email.trim(),
                    password,
                }),
            });

            const verifyPayload = await verifyResponse.json().catch(() => null);

            if (!verifyResponse.ok || !verifyPayload?.success) {
                setError(verifyPayload?.error || 'We could not verify ownership of that wallet.');
                return;
            }

            setStep('done');
        } catch (err) {
            captureException(err, { context: 'claimSubmit' });
            setError('Something went wrong completing your claim. Try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthShell
            title="Claim your credentials"
            subtitle="Already have a credential but no account? Prove you own the wallet it was issued to."
            footer={
                <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Link href="/auth/login" className="font-semibold text-primary hover:underline">
                        Sign in
                    </Link>
                </p>
            }
        >
            {step === 'done' ? (
                <div className="space-y-4">
                    <div
                        className="rounded-lg border border-success/25 bg-success/8 px-4 py-3 text-sm text-success"
                        role="status"
                    >
                        Your account is ready. Sign in to see the credentials issued to your wallet.
                    </div>
                    <Button
                        type="button"
                        size="lg"
                        className="w-full"
                        onClick={() => router.push('/auth/login')}
                    >
                        Go to sign in
                    </Button>
                </div>
            ) : (
                <div className="space-y-5">
                    <div className="rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex items-start gap-3">
                            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">
                                    {address ? 'Wallet connected' : 'Connect your wallet'}
                                </p>
                                <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                                    {address ?? 'The wallet your credential was issued to.'}
                                </p>
                            </div>
                        </div>

                        {!address && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-3 w-full"
                                onClick={handleConnect}
                                disabled={isConnecting}
                            >
                                {isConnecting ? 'Connecting…' : 'Connect wallet'}
                            </Button>
                        )}
                    </div>

                    {address && (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="claim-email">Email</Label>
                                <Input
                                    id="claim-email"
                                    type="email"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    placeholder="you@example.com"
                                    required
                                    autoComplete="email"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Used to recover your account if you ever lose access to this
                                    wallet.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="claim-password">Choose a password</Label>
                                <Input
                                    id="claim-password"
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    required
                                    autoComplete="new-password"
                                    aria-describedby="claim-password-requirements"
                                />
                                <ul
                                    id="claim-password-requirements"
                                    className="mt-2 grid gap-1.5 text-sm"
                                >
                                    {passwordRequirements.map((requirement) => (
                                        <li
                                            key={requirement.id}
                                            className={cn(
                                                'flex items-center gap-2',
                                                requirement.isMet
                                                    ? 'text-success'
                                                    : 'text-muted-foreground',
                                            )}
                                        >
                                            <CheckCircle2
                                                className={cn(
                                                    'h-4 w-4',
                                                    requirement.isMet
                                                        ? 'text-success'
                                                        : 'text-muted-foreground/40',
                                                )}
                                                aria-hidden="true"
                                            />
                                            <span>{requirement.label}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="claim-confirm">Confirm password</Label>
                                <Input
                                    id="claim-confirm"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    required
                                    autoComplete="new-password"
                                    aria-invalid={
                                        Boolean(confirmPassword) && password !== confirmPassword
                                    }
                                />
                            </div>

                            {error && (
                                <div
                                    className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                                    role="alert"
                                >
                                    {error}
                                </div>
                            )}

                            <Button type="submit" size="lg" disabled={submitting} className="w-full">
                                {submitting ? 'Verifying ownership…' : 'Sign and claim'}
                            </Button>
                        </form>
                    )}

                    {!address && error && (
                        <div
                            className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                </div>
            )}
        </AuthShell>
    );
}
