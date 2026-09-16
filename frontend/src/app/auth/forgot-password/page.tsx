'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import {
    buildAuthCallbackUrl,
    getFriendlyPasswordResetError,
    isValidEmail,
    sanitizeAuthRedirect,
} from '@/lib/authFlow';
import { requestPasswordReset } from '@/lib/supabase';

function ForgotPasswordForm() {
    const searchParams = useSearchParams();
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setMessage('');

        if (!isValidEmail(email)) {
            setError('Please enter a valid email address.');
            return;
        }

        setLoading(true);

        try {
            const { error } = await requestPasswordReset(
                email,
                buildAuthCallbackUrl('/auth/reset-password', nextRedirect),
            );

            if (error) {
                setError(getFriendlyPasswordResetError(error));
                return;
            }

            setMessage(
                'Password reset link sent. Check your inbox and open the latest recovery email.',
            );
        } catch (err: unknown) {
            setError(getFriendlyPasswordResetError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell
            title="Reset your password"
            subtitle="Enter your account email and we’ll send a secure reset link."
            footer={
                <div className="space-y-3 text-center text-sm text-muted-foreground">
                    <p>
                        Remembered it?{' '}
                        <Link
                            href={`/auth/login?next=${encodeURIComponent(nextRedirect)}`}
                            className="font-semibold text-primary hover:underline"
                        >
                            Back to sign in
                        </Link>
                    </p>
                    {/*
                      Acredia accounts are provisioned, not self-registered, so a
                      user who never receives the mail has no other way in.
                      Naming the fallback here prevents a silent dead end when
                      delivery is delayed, filtered, or rate-limited.
                    */}
                    <p className="text-xs">
                        Didn&apos;t receive it? Check your spam folder, then{' '}
                        <Link href="/contact" className="font-medium text-primary hover:underline">
                            contact your administrator
                        </Link>{' '}
                        — they can issue a direct reset link.
                    </p>
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        aria-invalid={Boolean(error)}
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
                    {loading ? 'Sending reset link…' : 'Send reset link'}
                </Button>
            </form>
        </AuthShell>
    );
}

export default function ForgotPasswordPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-background">
                    <div className="text-muted-foreground">Loading…</div>
                </div>
            }
        >
            <ForgotPasswordForm />
        </Suspense>
    );
}
