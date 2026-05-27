'use client';

import { useAuth, ProtectedRoute } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CredentialUploadForm } from '@/components/institution/CredentialUploadForm';
import { IssuedCredentialsList } from '@/components/institution/IssuedCredentialsList';
import Image from 'next/image';
import Link from 'next/link';
import { LogOut, Wallet, Upload, List, User, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useStellarAccount } from '@/contexts/StellarContext';
import { ConnectWallet } from '@/components/ui/ConnectWallet';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

import StudentCredentialsList from '@/components/student/StudentCredentialsList';

function DashboardContent() {
    const { user, userRole, signOut } = useAuth();
    const router = useRouter();
    const { address } = useStellarAccount();
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [institutionId, setInstitutionId] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Persist wallet address to institution row whenever it changes
    useEffect(() => {
        if (!user || userRole !== 'institution' || !institutionId || !address) return;

        supabase
            .from('institutions')
            .update({ wallet_address: address })
            .eq('id', institutionId)
            .then(({ error }) => {
                if (error) console.error('Error persisting wallet address:', error);
            });
    }, [address, institutionId, user, userRole]);

    // Fetch institution ID from database
    useEffect(() => {
        const fetchInstitutionId = async () => {
            if (!user || userRole !== 'institution') {
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('institutions')
                    .select('id, wallet_address')
                    .eq('auth_user_id', user.id)
                    .maybeSingle();

                if (error) {
                    console.error('Error fetching institution:', error);
                    toast.error('Failed to load institution data');
                } else if (data) {
                    setInstitutionId(data.id);
                    console.log('✅ Institution loaded:', data.id);
                } else {
                    console.warn('No institution record found for user');
                    toast.warning('Institution record not found. Creating profile...');

                    // Try to create institution record
                    const { data: newInst, error: createError } = await supabase
                        .from('institutions')
                        .insert([{
                            auth_user_id: user.id,
                            email: user.email,
                            name: user.email?.split('@')[0] || 'Institution',
                        }])
                        .select('id')
                        .single();

                    if (createError) {
                        console.error('Error creating institution:', createError);
                        toast.error('Failed to create institution profile');
                    } else if (newInst) {
                        setInstitutionId(newInst.id);
                        toast.success('Institution profile created');
                    }
                }
            } catch (error) {
                console.error('Error:', error);
                toast.error('An unexpected error occurred');
            } finally {
                setLoading(false);
            }
        };

        fetchInstitutionId();
    }, [user, userRole]);

    const handleSignOut = async () => {
        await signOut();
        router.push('/');
    };

    const handleCredentialIssued = () => {
        setRefreshTrigger((prev) => prev + 1);
        toast.success('Credential list will refresh!');
    };

    // Get institution data from user metadata
    const institutionName = user?.user_metadata?.name || 'Institution';
    const institutionWallet = address || '';

    return (
        <div className="min-h-screen bg-linear-to-br from-gray-50 via-teal-50 to-cyan-50">
            {/* Navigation */}
            <nav className="border-b border-gray-200 bg-white/90 backdrop-blur-lg sticky top-0 z-50 shadow-sm">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link href="/" className="flex items-center space-x-3">
                            <Image
                                src="/logo.png"
                                alt="Acredia Logo"
                                width={40}
                                height={40}
                                className="rounded-lg"
                            />
                            <span className="text-xl sm:text-2xl font-bold bg-linear-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                                ACREDIA
                            </span>
                        </Link>
                        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap sm:space-x-4">
                            <ConnectWallet />
                            <Button
                                onClick={handleSignOut}
                                variant="ghost"
                                className="text-gray-700 hover:text-red-600 text-sm sm:text-base px-3 sm:px-4"
                            >
                                <LogOut className="h-5 w-5 mr-2" />
                                <span className="hidden sm:inline">Sign Out</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Dashboard Content */}
            <div className="container mx-auto px-4 py-8">
                <div className="mb-8">
                    <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
                        Welcome, {user?.user_metadata?.name || 'User'}
                    </h1>
                    <p className="text-gray-600 text-lg capitalize">
                        {userRole} Dashboard
                    </p>
                </div>

                {/* Institution Dashboard */}
                {userRole === 'institution' && (
                    <div className="space-y-6">
                        {/* Loading State */}
                        {!institutionId && (
                            <Card className="border-gray-200 bg-white shadow-lg p-6">
                                <div className="flex items-center justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
                                    <p className="text-gray-600">Loading institution data...</p>
                                </div>
                            </Card>
                        )}

                        {/* Account Info Card */}
                        {institutionId && (
                            <Card className="border-gray-200 bg-white shadow-lg p-6">
                                <h3 className="text-xl font-bold text-gray-900 mb-4">
                                    Account Information
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-500">Email</p>
                                        <p className="text-gray-900 font-medium">{user?.email}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-500">Role</p>
                                        <p className="text-gray-900 font-medium capitalize">{userRole}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-500">Wallet Status</p>
                                        <p className="text-gray-900 font-medium">
                                            {address ? (
                                                <span className="text-teal-600">
                                                    Connected: {address.slice(0, 6)}...
                                                    {address.slice(-4)}
                                                </span>
                                            ) : (
                                                <span className="text-orange-600">Not Connected</span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Wallet Connection Warning */}
                        {institutionId && !address && (
                            <Card className="border-orange-200 bg-orange-50 p-6">
                                <div className="flex items-start space-x-3">
                                    <Wallet className="h-6 w-6 text-orange-600 mt-1" />
                                    <div>
                                        <h3 className="text-lg font-bold text-orange-900 mb-2">
                                            Connect Your Wallet
                                        </h3>
                                        <p className="text-orange-800 mb-4">
                                            You need to connect your wallet to issue credentials on the blockchain.
                                            Click the "Connect Wallet" button in the top right corner.
                                        </p>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Tabs for Issue and View */}
                        {institutionId && (
                            <Tabs defaultValue="issue" className="w-full">
                                <TabsList className="grid w-full max-w-2xl grid-cols-2">
                                    <TabsTrigger value="issue" className="flex items-center space-x-2">
                                        <Upload className="h-4 w-4" />
                                        <span>Issue Credential</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="view" className="flex items-center space-x-2">
                                        <List className="h-4 w-4" />
                                        <span>View Issued</span>
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="issue" className="mt-6">
                                    <CredentialUploadForm
                                        institutionId={institutionId}
                                        institutionName={institutionName}
                                        institutionWallet={institutionWallet}
                                        account={address}
                                        onSuccess={handleCredentialIssued}
                                    />
                                </TabsContent>

                                <TabsContent value="view" className="mt-6">
                                    <IssuedCredentialsList
                                        institutionId={institutionId}
                                        refreshTrigger={refreshTrigger}
                                    />
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>
                )}

                {/* Admin Dashboard — redirect to /admin */}
                {userRole === 'admin' && (
                    <div className="space-y-6">
                        <Card className="border-red-200 bg-gradient-to-br from-red-50 to-orange-50 p-8 shadow-lg">
                            <div className="flex items-center space-x-4 mb-6">
                                <div className="bg-red-100 p-3 rounded-2xl">
                                    <Shield className="h-10 w-10 text-red-600" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900">You&apos;re an Admin</h2>
                                    <p className="text-gray-600">Access the Admin Panel to manage institutions and authorize issuers.</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Link href="/admin">
                                    <div className="bg-white border border-red-200 rounded-xl p-6 hover:shadow-md hover:border-red-400 transition-all cursor-pointer group">
                                        <Shield className="h-8 w-8 text-red-600 mb-3 group-hover:scale-110 transition-transform" />
                                        <h3 className="font-bold text-gray-900 mb-1">Admin Dashboard</h3>
                                        <p className="text-sm text-gray-600">Authorize institutions, view system stats, and manage the contract.</p>
                                        <span className="text-xs text-red-600 font-semibold mt-2 inline-block">Open Admin Panel →</span>
                                    </div>
                                </Link>
                                <div className="bg-white border border-gray-200 rounded-xl p-6">
                                    <User className="h-8 w-8 text-teal-600 mb-3" />
                                    <h3 className="font-bold text-gray-900 mb-1">Connected Wallet</h3>
                                    <p className="text-sm text-gray-500 mb-2">Your Stellar address:</p>
                                    <p className="text-xs font-mono text-gray-700 break-all">
                                        {address || <span className="text-orange-500">Not connected — click &quot;Connect Wallet&quot; above</span>}
                                    </p>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                {/* Student Dashboard */}
                {userRole === 'student' && (
                    <div className="space-y-6">
                        {/* Account Info Card */}
                        <Card className="border-gray-200 bg-white shadow-lg p-6">
                            <h3 className="text-xl font-bold text-gray-900 mb-4">
                                Account Information
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Email</p>
                                    <p className="text-gray-900 font-medium">{user?.email}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Name</p>
                                    <p className="text-gray-900 font-medium">{user?.user_metadata?.name || 'Not set'}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Wallet Status</p>
                                    <p className="text-gray-900 font-medium">
                                        {address ? (
                                            <span className="text-teal-600">
                                                Connected: {address.slice(0, 6)}...
                                                {address.slice(-4)}
                                            </span>
                                        ) : (
                                            <span className="text-orange-600">Not Connected</span>
                                        )}
                                    </p>
                                </div>
                            </div>
                        </Card>

                        {/* Wallet Connection Warning */}
                        {!address && (
                            <Card className="border-orange-200 bg-orange-50 p-6">
                                <div className="flex items-start space-x-3">
                                    <Wallet className="h-6 w-6 text-orange-600 mt-1" />
                                    <div>
                                        <h3 className="text-lg font-bold text-orange-900 mb-2">
                                            Connect Your Wallet
                                        </h3>
                                        <p className="text-orange-800 mb-4">
                                            You need to connect your wallet to view your credentials on the blockchain.
                                            Click the "Connect Wallet" button in the top right corner.
                                        </p>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* Student Credentials List */}
                        <StudentCredentialsList
                            studentId={user?.id || ''}
                            studentWallet={address || undefined}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardContent />
        </ProtectedRoute>
    );
}
