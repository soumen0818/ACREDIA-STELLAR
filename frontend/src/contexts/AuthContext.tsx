'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, signOut, safeGetSession } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { buildAuthRedirect } from '@/lib/authFlow';
import { resolveUserRoleClient } from '@/lib/roleResolver';
import { getE2eState } from '@/lib/e2e';
import {
    createRoleSession,
    INITIAL_SESSION_STATE,
    routeGate,
    type RoleSession,
    type SessionState,
} from '@/lib/authSession';
import type { AppRole, RoleState } from '@/types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    userRole: RoleState;
    signOut: () => Promise<void>;
}

// No default value: a component outside the provider would otherwise see a
// session that never finishes loading, with no sign the provider is missing.
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<SessionState>(INITIAL_SESSION_STATE);
    const sessionRef = useRef<RoleSession | null>(null);

    useEffect(() => {
        // `loading` stays true until the role is known, and only the latest
        // lookup applies (issue #342; see src/lib/authSession.ts).
        const session = createRoleSession(
            (user) => resolveUserRoleClient(supabase, user),
            (patch) => setState((previous) => ({ ...previous, ...patch })),
        );
        sessionRef.current = session;

        const e2eState = getE2eState();
        if (e2eState?.enabled && e2eState.session) {
            // Through the same path as a real session, so E2E tests exercise
            // the ordering above rather than a synchronous shortcut.
            void session.update(e2eState.session.user as unknown as User);
            return () => session.stop();
        }

        // Check active sessions
        safeGetSession()
            .then(({ data: { session: active } }) => session.update((active?.user ?? null) as User | null))
            .catch(() => session.clear());

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, active) => {
            void session.update((active?.user ?? null) as User | null);
        });

        return () => {
            session.stop();
            subscription.unsubscribe();
        };
    }, []);

    const handleSignOut = async () => {
        await signOut();
        sessionRef.current?.clear();
    };

    return (
        <AuthContext.Provider
            value={{
                user: state.user,
                loading: state.loading,
                userRole: state.userRole,
                signOut: handleSignOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        // Mounted by app/(console)/layout.tsx only (review §4.1).
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Protected route component
/**
 * UI-only route guard.
 *
 * IMPORTANT: This is for UX only (preventing flashes of content).
 * Every privileged action MUST be re-checked server-side (via serverAuth.ts)
 * or on-chain. Do not rely on this component for actual security.
 */
export function ProtectedRoute({
    children,
    allowedRoles,
}: {
    children: React.ReactNode;
    allowedRoles?: AppRole[];
}) {
    const { user, loading, userRole } = useAuth();
    const router = useRouter();
    // A known user whose role is still being looked up is loading: a
    // role-gated page must not mount before it is known to be allowed (#342).
    const gate = routeGate({ user, loading, userRole }, allowedRoles);

    useEffect(() => {
        if (gate === 'sign-in') {
            const currentPath =
                typeof window !== 'undefined'
                    ? buildAuthRedirect(window.location.pathname, window.location.search)
                    : '/auth/login';
            router.push(currentPath);
        }

        if (gate === 'not-allowed') {
            router.push('/dashboard');
        }
    }, [gate, router]);

    if (gate === 'loading') {
        return (
            <div className="min-h-dvh bg-gray-50">
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

    if (gate !== 'render') {
        return null;
    }

    return <>{children}</>;
}
