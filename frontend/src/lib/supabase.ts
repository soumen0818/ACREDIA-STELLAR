import { createClient } from '@supabase/supabase-js';
import { normalizeEmail } from './authFlow';
import { getE2eState } from './e2e';
import { runtimeConfig } from './runtimeConfig';

const supabaseUrl = runtimeConfig.supabase.url;
const supabaseAnonKey = runtimeConfig.supabase.anonKey;

import { debugWarn } from './debug';

if (!supabaseUrl || !supabaseAnonKey) {
    if (!runtimeConfig.isProduction) {
        debugWarn('⚠️ Missing Supabase environment variables');
    }
}

export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder',
);

function isInvalidRefreshTokenError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
    return message.includes('Invalid Refresh Token') || message.includes('Refresh Token Not Found');
}

async function clearLocalAuthSession() {
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch {
        // Ignore cleanup failures; the local session state is already invalid.
    }
}

function shouldRefreshSession(expiresAt?: number): boolean {
    if (!expiresAt) {
        return false;
    }

    // Refresh shortly before expiry so API routes do not receive a stale token.
    return expiresAt * 1000 - Date.now() < 60 * 1000;
}

export async function safeGetSession() {
    const e2eState = getE2eState();
    if (e2eState?.enabled && e2eState.session) {
        return { data: { session: e2eState.session }, error: null };
    }

    try {
        const { data, error } = await supabase.auth.getSession();

        if (error && isInvalidRefreshTokenError(error)) {
            await clearLocalAuthSession();
            return { data: { session: null }, error: null };
        }

        if (data.session && shouldRefreshSession(data.session.expires_at)) {
            const refreshed = await supabase.auth.refreshSession();

            if (refreshed.error && isInvalidRefreshTokenError(refreshed.error)) {
                await clearLocalAuthSession();
                return { data: { session: null }, error: null };
            }

            return refreshed;
        }

        return { data, error };
    } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
            await clearLocalAuthSession();
            return { data: { session: null }, error: null };
        }

        throw error;
    }
}

// Direct exports for easier imports
//
// There is no `signUp` here by design. Acredia is closed and delegated
// (Issue #239): admins provision institutions, institutions provision
// students. No client path may create an account, so the only way in is a
// provisioner-issued invite.

export async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
    });
    return { data, error };
}

export async function requestPasswordReset(email: string, redirectTo?: string) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(
        normalizeEmail(email),
        redirectTo ? { redirectTo } : undefined
    );
    return { data, error };
}

export async function updatePassword(password: string) {
    const { data, error } = await supabase.auth.updateUser({ password });
    return { data, error };
}

export async function resendVerificationEmail(email: string, emailRedirectTo?: string) {
    if (getE2eState()?.enabled) {
        return {
            data: { user: { email: normalizeEmail(email) } },
            error: null,
        };
    }

    const credentials = {
        type: 'signup' as const,
        email: normalizeEmail(email),
        ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
    };

    const { data, error } = await supabase.auth.resend(credentials);
    return { data, error };
}

export async function signOut() {
    if (getE2eState()?.enabled) {
        const state = getE2eState();
        if (state) {
            state.session = null;
            state.walletAddress = null;
            state.role = 'unknown';
        }

        return { error: null };
    }

    const { error } = await supabase.auth.signOut();
    return { error };
}
