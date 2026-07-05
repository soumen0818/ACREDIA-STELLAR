'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2 } from 'lucide-react';
import {
    getPasswordRequirements,
    getPasswordValidationError,
    getErrorMessage,
    sanitizeAuthRedirect,
} from '@/lib/authFlow';
import { safeGetSession, supabase, updatePassword } from '@/lib/supabase';

function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [checkingSession, setCheckingSession] = useState(true);
    const [hasRecoverySession, setHasRecoverySession] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const passwordRequirements = getPasswordRequirements(password);

    useEffect(() => {
        let mounted = true;
        let sessionTimeout: ReturnType<typeof setTimeout> | undefined;

        const finishChecking = (ready: boolean) => {
            if (!mounted) {
                return;
            }

            setHasRecoverySession(ready);
            setCheckingSession(false);
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || session?.user) {
                finishChecking(true);
            }
        });

        safeGetSession()
            .then(({ data: { session } }) => {
                if (session?.user) {
                    finishChecking(true);
                    return;
                }

                sessionTimeout = setTimeout(() => finishChecking(false), 1500);
            })
            .catch(() => {
                sessionTimeout = setTimeout(() => finishChecking(false), 1500);
            });

        return () => {
            mounted = false;
            subscription.unsubscribe();
            if (sessionTimeout) {
                clearTimeout(sessionTimeout);
            }
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setMessage('');

        const passwordError = getPasswordValidationError(password);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);

        try {
            const { error } = await updatePassword(password);

            if (error) {
                setError(error.message);
                return;
            }

            setMessage('Password updated. You can now continue to your account.');
            setPassword('');
            setConfirmPassword('');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to update password'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-gray-200 bg-white shadow-2xl p-8">
                <div className="flex flex-col items-center mb-8">
                    <Image
                        src="/logo.png"
                        alt="Acredia Logo"
                        width={80}
                        height={80}
                        className="rounded-xl mb-4"
                    />
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Create New Password</h1>
                    <p className="text-gray-600 text-center">
                        Choose a new password for your Acredia account.
                    </p>
                </div>

                {checkingSession && (
                    <div className="bg-teal-50 border border-teal-200 text-teal-700 px-4 py-2 rounded" role="status">
                        Checking your recovery link...
                    </div>
                )}

                {!checkingSession && !hasRecoverySession && (
                    <div className="space-y-4">
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded" role="alert">
                            This reset link is invalid or has expired. Request a new password reset email.
                        </div>
                        <Button
                            type="button"
                            onClick={() => router.push(`/auth/forgot-password?next=${encodeURIComponent(nextRedirect)}`)}
                            className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                        >
                            Request new reset link
                        </Button>
                    </div>
                )}

                {!checkingSession && hasRecoverySession && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <Label htmlFor="password" className="text-gray-900">
                                New Password
                            </Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="New password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                aria-describedby="password-requirements"
                                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                            />
                            <ul id="password-requirements" className="mt-2 grid gap-1 text-sm text-gray-600">
                                {passwordRequirements.map((requirement) => (
                                    <li key={requirement.id} className="flex items-center gap-2">
                                        <CheckCircle2
                                            className={`h-4 w-4 ${requirement.isMet ? 'text-teal-600' : 'text-gray-300'}`}
                                            aria-hidden="true"
                                        />
                                        <span>{requirement.label}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <Label htmlFor="confirm-password" className="text-gray-900">
                                Confirm New Password
                            </Label>
                            <Input
                                id="confirm-password"
                                type="password"
                                placeholder="Confirm new password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                aria-invalid={Boolean(confirmPassword) && password !== confirmPassword}
                                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                            />
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded" role="alert">
                                {error}
                            </div>
                        )}

                        {message && (
                            <div className="bg-teal-50 border border-teal-200 text-teal-700 px-4 py-2 rounded" role="status">
                                {message}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                        >
                            {loading ? 'Updating password...' : 'Update password'}
                        </Button>

                        {message && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => router.push(nextRedirect)}
                                className="w-full"
                            >
                                Continue
                            </Button>
                        )}
                    </form>
                )}

                <div className="mt-6 text-center">
                    <Link
                        href={`/auth/login?next=${encodeURIComponent(nextRedirect)}`}
                        className="text-teal-600 hover:text-teal-700 font-medium"
                    >
                        Back to sign in
                    </Link>
                </div>
            </Card>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center">
                <div className="text-gray-700">Loading...</div>
            </div>
        }>
            <ResetPasswordForm />
        </Suspense>
    );
}
