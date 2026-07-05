'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase, safeGetSession } from '@/lib/supabase';
import { toast } from 'sonner';
import Link from 'next/link';
import Image from 'next/image';
import { Shield, Lock, Mail, Eye, EyeOff, ArrowLeft, Wallet } from 'lucide-react';

export default function AdminLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // Check if already logged in
        const checkSession = async () => {
            try {
                const {
                    data: { session },
                } = await safeGetSession();
                if (session?.user) {
                    router.push('/admin');
                }
            } catch {
                // Ignore invalid cached sessions and allow normal login flow.
            }
        };
        checkSession();
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        setLoading(true);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                toast.error('Login failed: ' + (error instanceof Error ? error.message : String(error)));
                return;
            }

            if (data.user) {
                toast.success('Login successful! Now connect your contract owner wallet.');
                router.push('/admin');
            }
        } catch (error: unknown) {
            toast.error('An error occurred: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-gray-50 via-red-50 to-orange-50 flex items-center justify-center p-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute top-20 right-0 w-96 h-96 bg-red-200/20 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-orange-200/20 rounded-full blur-3xl"></div>
            </div>

            <Card className="w-full max-w-md p-8 space-y-6 relative z-10 shadow-2xl border-2 border-red-100">
                {/* Logo & Title */}
                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <div className="relative">
                            <Image
                                src="/logo.png"
                                alt="Acredia Logo"
                                width={80}
                                height={80}
                                className="rounded-lg"
                            />
                            <Shield className="absolute -bottom-2 -right-2 h-11 w-11 text-red-600 bg-white rounded-full p-1 shadow-lg" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Admin Portal</h1>
                    <p className="text-gray-600">Contract Owner Access Only</p>
                </div>

                {/* Admin Notice */}
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                        <Wallet className="h-5 w-5 text-red-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-red-900">
                                Wallet Verification Required
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                                After login, you must connect the contract owner wallet to access
                                admin features.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email" className="text-gray-700">
                            Admin Email
                        </Label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="admin@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="pl-10 border-gray-300 focus:border-red-500 focus:ring-red-500"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-gray-700">
                            Password
                        </Label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                            <Input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="pl-10 pr-10 border-gray-300 focus:border-red-500 focus:ring-red-500"
                                disabled={loading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? (
                                    <EyeOff className="h-5 w-5" />
                                ) : (
                                    <Eye className="h-5 w-5" />
                                )}
                            </button>
                        </div>
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-red-600 hover:bg-red-700 text-white"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Authenticating...
                            </>
                        ) : (
                            <>
                                <Shield className="h-4 w-4 mr-2" />
                                Access Admin Portal
                            </>
                        )}
                    </Button>
                </form>

                {/* Setup Link */}
                <div className="pt-4 border-t border-gray-200 space-y-2">
                    <p className="text-center text-sm text-gray-600">
                        First time? Need help getting started?
                    </p>
                    <Link href="/auth/admin-setup">
                        <Button
                            variant="outline"
                            className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
                        >
                            <Shield className="h-4 w-4 mr-2" />
                            Admin Setup Guide
                        </Button>
                    </Link>
                    <p className="text-center text-xs text-gray-500 mt-2">
                        Or register a new account below
                    </p>
                    <Link href="/auth/register">
                        <Button variant="ghost" className="w-full text-gray-600 hover:bg-gray-50">
                            Register New Account
                        </Button>
                    </Link>
                </div>

                {/* Back Link */}
                <div className="pt-2">
                    <Link href="/">
                        <Button
                            variant="ghost"
                            className="w-full text-gray-600 hover:text-gray-900"
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Home
                        </Button>
                    </Link>
                </div>
            </Card>
        </div>
    );
}
