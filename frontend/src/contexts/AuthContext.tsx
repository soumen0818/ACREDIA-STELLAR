'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, signOut, safeGetSession } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { buildAuthRedirect } from '@/lib/authFlow';
import { resolveUserRoleClient } from '@/lib/roleResolver';
import type { AppRole, RoleState } from '@/types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    userRole: RoleState;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    userRole: 'loading',
    signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState<RoleState>('loading');

    const resolveRole = async (nextUser: User | null) => {
        if (!nextUser) {
            setUserRole('unknown');
            return;
        }

        try {
            const role = await resolveUserRoleClient(supabase, nextUser);
            setUserRole(role);
        } catch {
            // Keep the app usable if resolution fails — fall back to unknown.
            setUserRole('unknown');
        }
    };

    useEffect(() => {
        // Check active sessions
        safeGetSession()
            .then(({ data: { session } }) => {
                const nextUser = session?.user ?? null;
                setUser(nextUser);
                resolveRole(nextUser);
                setLoading(false);
            })
            .catch(() => {
                setUser(null);
                setUserRole('unknown');
                setLoading(false);
            });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUser = session?.user ?? null;
            setUser(nextUser);
            resolveRole(nextUser);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleSignOut = async () => {
        await signOut();
        setUser(null);
        setUserRole('unknown');
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                userRole,
                signOut: handleSignOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Protected route component
export function ProtectedRoute({
    children,
    allowedRoles,
}: {
    children: React.ReactNode;
    allowedRoles?: AppRole[];
}) {
    const { user, loading, userRole } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !user) {
            const currentPath =
                typeof window !== 'undefined'
                    ? buildAuthRedirect(window.location.pathname, window.location.search)
                    : '/auth/login';
            router.push(currentPath);
        }

        if (
            !loading &&
            user &&
            allowedRoles &&
            userRole !== 'loading' &&
            userRole !== 'unknown' &&
            !allowedRoles.includes(userRole)
        ) {
            router.push('/dashboard');
        }
    }, [user, loading, userRole, router, allowedRoles]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur-lg">
                    <div className="container mx-auto px-4 py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                                <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-200"></div>
                                <div className="h-6 w-24 animate-pulse rounded bg-gray-200"></div>
                            </div>
                            <div className="flex items-center space-x-4">
                                <div className="h-9 w-32 animate-pulse rounded-md bg-gray-200"></div>
                                <div className="h-9 w-24 animate-pulse rounded-md bg-gray-200"></div>
                            </div>
                        </div>
                    </div>
                </nav>
                <div className="container mx-auto px-4 py-8">
                    <div className="mb-8">
                        <div className="h-10 w-64 animate-pulse rounded bg-gray-200 mb-4"></div>
                        <div className="h-6 w-48 animate-pulse rounded bg-gray-200"></div>
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                        <div className="h-40 animate-pulse rounded-xl bg-white shadow-sm border border-gray-200"></div>
                        <div className="h-40 animate-pulse rounded-xl bg-white shadow-sm border border-gray-200"></div>
                        <div className="h-40 animate-pulse rounded-xl bg-white shadow-sm border border-gray-200"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    if (
        allowedRoles &&
        userRole !== 'loading' &&
        userRole !== 'unknown' &&
        !allowedRoles.includes(userRole)
    ) {
        return null;
    }

    return <>{children}</>;
}
