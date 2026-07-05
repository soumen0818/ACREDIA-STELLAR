'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, KeyRound, Lock, Shield, Terminal } from 'lucide-react';

export default function AdminSetupPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-gray-50 via-red-50 to-orange-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-red-200/20 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-orange-200/20 blur-3xl"></div>
            </div>

            <Card className="w-full max-w-xl p-8 space-y-6 relative z-10 shadow-2xl border-2 border-red-100">
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
                            <Shield className="absolute -bottom-2 -right-2 h-11 w-11 rounded-full bg-white p-1 text-red-600 shadow-lg" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Admin Setup Locked</h1>
                    <p className="text-gray-600">
                        Admin accounts cannot be created from a public browser route.
                    </p>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                        <Lock className="h-5 w-5 text-red-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-red-900">
                                Public admin registration is disabled
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                                Acredia now requires administrators to be provisioned through a
                                trusted backend/database setup path. New public signups are always
                                treated as non-admin users until a trusted operator grants access.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4">
                        <KeyRound className="h-5 w-5 text-gray-700 mt-0.5" />
                        <div>
                            <h2 className="text-sm font-semibold text-gray-900">
                                Trusted admin allowlist
                            </h2>
                            <p className="text-xs text-gray-600 mt-1">
                                Set <span className="font-mono">ADMIN_EMAIL_ALLOWLIST</span> on the
                                server with the email addresses that are allowed to use admin API
                                routes.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4">
                        <Terminal className="h-5 w-5 text-gray-700 mt-0.5" />
                        <div>
                            <h2 className="text-sm font-semibold text-gray-900">
                                Provision from Supabase
                            </h2>
                            <p className="text-xs text-gray-600 mt-1">
                                Create the user through a trusted Supabase/admin process and update
                                that user&apos;s profile role to{' '}
                                <span className="font-mono">admin</span>. Never grant admin through
                                client-submitted signup metadata.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-200 space-y-2">
                    <Link href="/auth/admin-login">
                        <Button
                            variant="ghost"
                            className="w-full text-gray-600 hover:text-gray-900"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Admin Login
                        </Button>
                    </Link>
                </div>
            </Card>
        </div>
    );
}
