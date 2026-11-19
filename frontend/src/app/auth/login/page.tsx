'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { resendVerificationEmail, safeGetSession, signIn } from '@/lib/supabase';
import {
    buildAuthCallbackUrl,
    getErrorMessage,
    isEmailConfirmationError,
    isValidEmail,
    sanitizeAuthRedirect,
} from '@/lib/authFlow';

/**
 * Presentational copy for the shared sign-in page.
 *
 * The `role` query parameter ONLY changes the heading so the entry points
 * linked from the footer feel purpose-built. It grants nothing: the account's
 * real role is always resolved server-side after authentication, so passing an
 * arbitrary value here cannot escalate privileges.
 */
const LOGIN_COPY = {
    student: {
        title: 'Student sign in',
        subtitle: 'Access the credentials issued to you and share them with anyone.',
    },
    institution: {
        title: 'Institution sign in',
        subtitle: 'Issue, manage, and revoke credentials for your students.',
    },
    default: {
        title: 'Welcome back',
        subtitle: 'Sign in to access your Acredia dashboard.',
    },
} as const;

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

    const roleParam = searchParams.get('role');
    const copy =
        roleParam === 'student'
            ? LOGIN_COPY.student
            : roleParam === 'institution'
              ? LOGIN_COPY.institution
              : LOGIN_COPY.default;

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [canResendVerification, setCanResendVerification] = useState(false);

    useEffect(() => {
        safeGetSession()
            .then(({ data: { session } }) => {
                if (session) {
                    router.replace(nextRedirect);
                }
            })
            .catch(() => {
                // Login remains usable if session probing fails.
            });
    }, [nextRedirect, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');
        setCanResendVerification(false);

        try {
            const { error } = await signIn(email, password);

            if (error) {
                setError(error.message);
                setCanResendVerification(isEmailConfirmationError(error.message));
                return;
            }

            router.push(nextRedirect);
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'An error occurred during login'));
        } finally {
            setLoading(false);
        }
    };

    const handleResendVerification = async () => {
        setError('');
        setMessage('');

        if (!isValidEmail(email)) {
            setError('Enter the email address you used to create your account.');
            return;
        }

        setResending(true);

        try {
            const { error } = await resendVerificationEmail(
                email,
                buildAuthCallbackUrl('/auth/login', nextRedirect),
            );

            if (error) {
                setError(error.message);
                return;
            }

            setMessage(
                'Verification email sent. Check your inbox and follow the confirmation link.',
            );
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to resend verification email'));
        } finally {
            setResending(false);
        }
    };

    return (
        <AuthShell
            title={copy.title}
            subtitle={copy.subtitle}
            footer={
                <div className="space-y-4 text-center">
                    <p className="text-sm text-muted-foreground">
                        Accounts are created by your administrator.{' '}
                        <Link href="/contact" className="font-semibold text-primary hover:underline">
                            Contact us
                        </Link>{' '}
                        to get set up.
                    </p>
                    <Link
                        href="/auth/admin-login"
                        className="inline-flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <Shield className="h-4 w-4" />
                        Administrator access
                    </Link>
                </div>
            }
        >
            <form onSubmit={handleLogin} className="space-y-5">
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
                        aria-invalid={Boolean(error) && !isValidEmail(email)}
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="password">Password</Label>
                        <Link
                            href={`/auth/forgot-password?next=${encodeURIComponent(nextRedirect)}`}
                            className="text-sm font-medium text-primary hover:underline"
                        >
                            Forgot password?
                        </Link>
                    </div>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
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

                {canResendVerification && (
                    <Button
                        type="button"
                        variant="outline"
                        disabled={resending}
                        onClick={handleResendVerification}
                        className="w-full"
                    >
                        {resending ? 'Sending verification email…' : 'Resend verification email'}
                    </Button>
                )}

                <Button type="submit" size="lg" disabled={loading} className="w-full">
                    {loading ? 'Signing in…' : 'Sign in'}
                </Button>
            </form>
        </AuthShell>
    );
}

export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-dvh items-center justify-center bg-background">
                    <div className="text-muted-foreground">Loading…</div>
                </div>
            }
        >
            <LoginForm />
        </Suspense>
    );
}
