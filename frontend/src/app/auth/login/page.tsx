'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';
import { resendVerificationEmail, safeGetSession, signIn } from '@/lib/supabase';
import {
    buildAuthCallbackUrl,
    getErrorMessage,
    isEmailConfirmationError,
    isValidEmail,
    sanitizeAuthRedirect,
} from '@/lib/authFlow';

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

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
                buildAuthCallbackUrl('/auth/login', nextRedirect)
            );

            if (error) {
                setError(error.message);
                return;
            }

            setMessage('Verification email sent. Check your inbox and follow the confirmation link.');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to resend verification email'));
        } finally {
            setResending(false);
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
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
                    <p className="text-gray-600 text-center">
                        Sign in to access your Acredia account
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <Label htmlFor="email" className="text-gray-900">
                            Email
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="your.email@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            aria-invalid={Boolean(error) && !isValidEmail(email)}
                            className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="password" className="text-gray-900">
                                Password
                            </Label>
                            <Link
                                href={`/auth/forgot-password?next=${encodeURIComponent(nextRedirect)}`}
                                className="text-sm font-medium text-teal-600 hover:text-teal-700"
                            >
                                Forgot password?
                            </Link>
                        </div>
                        <Input
                            id="password"
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
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

                    {canResendVerification && (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={resending}
                            onClick={handleResendVerification}
                            className="w-full border-teal-200 text-teal-700 hover:bg-teal-50"
                        >
                            {resending ? 'Sending verification email...' : 'Resend verification email'}
                        </Button>
                    )}

                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </Button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-gray-600">
                        Don't have an account?{' '}
                        <Link
                            href={`/auth/register?next=${encodeURIComponent(nextRedirect)}`}
                            className="text-teal-600 hover:text-teal-700 font-medium"
                        >
                            Sign up
                        </Link>
                    </p>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 text-center">
                    <Link
                        href="/auth/admin-login"
                        className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center justify-center gap-2"
                    >
                        <Shield className="h-4 w-4" />
                        Admin Access
                    </Link>
                </div>

                <div className="mt-4 text-center">
                    <Link
                        href="/"
                        className="text-gray-500 hover:text-gray-700 text-sm"
                    >
                        Back to home
                    </Link>
                </div>
            </Card>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center">
                <div className="text-gray-700">Loading...</div>
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}
