'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, CheckCircle2, GraduationCap, Mail } from 'lucide-react';
import { resendVerificationEmail, signUp } from '@/lib/supabase';
import {
    buildAuthCallbackUrl,
    getErrorMessage,
    getPasswordRequirements,
    normalizeEmail,
    sanitizeAuthRedirect,
    validateRegistrationInput,
} from '@/lib/authFlow';

type UserRole = 'institution' | 'student';

function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const roleParam = searchParams.get('role');
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

    const [role, setRole] = useState<UserRole>(roleParam === 'institution' ? 'institution' : 'student');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [confirmationEmail, setConfirmationEmail] = useState('');

    const passwordRequirements = getPasswordRequirements(password);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        const validationError = validateRegistrationInput({
            name,
            email,
            password,
            confirmPassword,
        });

        if (validationError) {
            setError(validationError);
            setLoading(false);
            return;
        }

        try {
            const { data, error } = await signUp(email, password, {
                emailRedirectTo: buildAuthCallbackUrl('/auth/login', nextRedirect),
                data: {
                    name: name.trim(),
                    role,
                },
            });

            if (error) {
                setError(error.message);
                return;
            }

            if (data.session) {
                router.push(nextRedirect);
                return;
            }

            setConfirmationEmail(normalizeEmail(email));
            setPassword('');
            setConfirmPassword('');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'An error occurred during registration'));
        } finally {
            setLoading(false);
        }
    };

    const handleResendVerification = async () => {
        setError('');
        setMessage('');
        setResending(true);

        try {
            const { error } = await resendVerificationEmail(
                confirmationEmail,
                buildAuthCallbackUrl('/auth/login', nextRedirect)
            );

            if (error) {
                setError(error.message);
                return;
            }

            setMessage('Verification email sent again. Check your inbox for the latest link.');
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to resend verification email'));
        } finally {
            setResending(false);
        }
    };

    if (confirmationEmail) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4">
                <Card className="w-full max-w-md border-gray-200 bg-white shadow-2xl p-8">
                    <div className="flex flex-col items-center mb-8">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
                            <Mail className="h-11 w-11 text-teal-600" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">Check Your Email</h1>
                        <p className="text-gray-600 text-center">
                            We sent a verification link to <span className="font-medium text-gray-900">{confirmationEmail}</span>.
                            Confirm your email, then continue to Acredia.
                        </p>
                    </div>

                    {error && (
                        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded" role="alert">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="mb-4 bg-teal-50 border border-teal-200 text-teal-700 px-4 py-2 rounded" role="status">
                            {message}
                        </div>
                    )}

                    <div className="space-y-3">
                        <Button
                            type="button"
                            disabled={resending}
                            onClick={handleResendVerification}
                            className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                        >
                            {resending ? 'Sending...' : 'Resend verification email'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.push(`/auth/login?next=${encodeURIComponent(nextRedirect)}`)}
                            className="w-full"
                        >
                            Go to sign in
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

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
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Account</h1>
                    <p className="text-gray-600 text-center">
                        Join Acredia to manage your credentials
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <button
                        type="button"
                        onClick={() => setRole('institution')}
                        aria-pressed={role === 'institution'}
                        className={`p-4 rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                            role === 'institution'
                                ? 'border-blue-500 bg-blue-500/10'
                                : 'border-slate-300 hover:border-slate-400 bg-white'
                        }`}
                    >
                        <Building2
                            className={`h-11 w-11 mx-auto mb-2 ${role === 'institution' ? 'text-blue-600' : 'text-slate-700'}`}
                        />
                        <p
                            className={`${role === 'institution' ? 'text-blue-700 font-medium' : 'text-slate-700 font-medium'}`}
                        >
                            Institution
                        </p>
                    </button>
                    <button
                        type="button"
                        onClick={() => setRole('student')}
                        aria-pressed={role === 'student'}
                        className={`p-4 rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                            role === 'student'
                                ? 'border-blue-500 bg-blue-500/10'
                                : 'border-slate-300 hover:border-slate-400 bg-white'
                        }`}
                    >
                        <GraduationCap
                            className={`h-11 w-11 mx-auto mb-2 ${role === 'student' ? 'text-blue-600' : 'text-slate-700'}`}
                        />
                        <p
                            className={`${role === 'student' ? 'text-blue-700 font-medium' : 'text-slate-700 font-medium'}`}
                        >
                            Student
                        </p>
                    </button>
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                        <Label htmlFor="name" className="text-gray-900">
                            {role === 'institution' ? 'Institution Name' : 'Full Name'}
                        </Label>
                        <Input
                            id="name"
                            type="text"
                            placeholder={role === 'institution' ? 'Harvard University' : 'John Doe'}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            autoComplete="name"
                            className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                        />
                    </div>

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
                            className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                        />
                    </div>

                    <div>
                        <Label htmlFor="password" className="text-gray-900">
                            Password
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="Password"
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
                            Confirm Password
                        </Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            placeholder="Confirm password"
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

                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                    >
                        {loading ? 'Creating account...' : 'Create Account'}
                    </Button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-gray-600">
                        Already have an account?{' '}
                        <Link
                            href={`/auth/login?next=${encodeURIComponent(nextRedirect)}`}
                            className="text-teal-600 hover:text-teal-700 font-medium"
                        >
                            Sign in
                        </Link>
                    </p>
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

export default function RegisterPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50 flex items-center justify-center">
                <div className="text-gray-700">Loading...</div>
            </div>
        }>
            <RegisterForm />
        </Suspense>
    );
}
