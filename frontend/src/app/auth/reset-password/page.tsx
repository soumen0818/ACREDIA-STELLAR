'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { cn } from '@/lib/utils';
import {
    getErrorMessage,
    getPasswordRequirements,
    getPasswordValidationError,
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
        <AuthShell
            title="Create a new password"
            subtitle="Choose a new password for your Acredia account."
            footer={
                <p className="text-center text-sm text-muted-foreground">
                    <Link
                        href={`/auth/login?next=${encodeURIComponent(nextRedirect)}`}
                        className="font-semibold text-primary hover:underline"
                    >
                        Back to sign in
                    </Link>
                </p>
            }
        >
            {checkingSession && (
                <div
                    className="rounded-lg border border-info/25 bg-info/8 px-4 py-3 text-sm text-info"
                    role="status"
                >
                    Checking your recovery link…
                </div>
            )}

            {!checkingSession && !hasRecoverySession && (
                <div className="space-y-4">
                    <div
                        className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                        role="alert"
                    >
                        This reset link is invalid or has expired. Request a new password reset
                        email.
                    </div>
                    <Button
                        type="button"
                        size="lg"
                        onClick={() =>
                            router.push(
                                `/auth/forgot-password?next=${encodeURIComponent(nextRedirect)}`,
                            )
                        }
                        className="w-full"
                    >
                        Request new reset link
                    </Button>
                </div>
            )}

            {!checkingSession && hasRecoverySession && (
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="password">New password</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            aria-describedby="password-requirements"
                        />
                        <ul id="password-requirements" className="mt-2 grid gap-1.5 text-sm">
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
                        <Label htmlFor="confirm-password">Confirm new password</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            aria-invalid={Boolean(confirmPassword) && password !== confirmPassword}
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

                    {message && (
                        <div
                            className="rounded-lg border border-success/25 bg-success/8 px-4 py-3 text-sm text-success"
                            role="status"
                        >
                            {message}
                        </div>
                    )}

                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                        {loading ? 'Updating password…' : 'Update password'}
                    </Button>

                    {message && (
                        <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            onClick={() => router.push(nextRedirect)}
                            className="w-full"
                        >
                            Continue
                        </Button>
                    )}
                </form>
            )}
        </AuthShell>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-dvh items-center justify-center bg-background">
                    <div className="text-muted-foreground">Loading…</div>
                </div>
            }
        >
            <ResetPasswordForm />
        </Suspense>
    );
}
