'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    buildAuthCallbackUrl,
    getErrorMessage,
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
                buildAuthCallbackUrl('/auth/reset-password', nextRedirect)
            );

            if (error) {
                setError(error.message);
                return;
            }

            setMessage('Password reset link sent. Check your inbox and open the latest recovery email.');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to send password reset email'));
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
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Reset Password</h1>
                    <p className="text-gray-600 text-center">
                        Enter your account email and we will send a secure reset link.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                            aria-invalid={Boolean(error)}
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
                        {loading ? 'Sending reset link...' : 'Send reset link'}
                    </Button>
                </form>

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

export default function ForgotPasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center">
                <div className="text-gray-700">Loading...</div>
            </div>
        }>
            <ForgotPasswordForm />
        </Suspense>
    );
}
