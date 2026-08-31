import { createClient } from '@supabase/supabase-js';
import { normalizeEmail } from './authFlow';
import { getE2eState } from './e2e';
import { runtimeConfig } from './runtimeConfig';

const supabaseUrl = runtimeConfig.supabase.url;
const supabaseAnonKey = runtimeConfig.supabase.anonKey;

import { debugWarn } from './debug';
import { resolveInstitutionIdForUser } from './institutionMembership';

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

// Helper functions for authentication
export const authHelpers = {
    async signIn(email: string, password: string) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizeEmail(email),
            password,
        });
        return { data, error };
    },

    async requestPasswordReset(email: string, redirectTo?: string) {
        return requestPasswordReset(email, redirectTo);
    },

    async updatePassword(password: string) {
        return updatePassword(password);
    },

    async resendVerificationEmail(email: string, emailRedirectTo?: string) {
        return resendVerificationEmail(email, emailRedirectTo);
    },

    async signOut() {
        const { error } = await supabase.auth.signOut();
        return { error };
    },

    async getSession() {
        const { data, error } = await safeGetSession();
        return { data: data.session, error };
    },

    async getUser() {
        const { data, error } = await supabase.auth.getUser();
        return { data: data.user, error };
    },
};

// Database helpers
export const dbHelpers = {
    // Institutions
    //
    // There is no `createInstitution` here by design. It survived the Issue
    // #239 cleanup unreferenced, but a browser-side insert into `institutions`
    // (plus an `owner` membership row) is precisely the self-provisioning path
    // that removing public signup was meant to close. Institutions are created
    // only by an admin, through `POST /api/admin/institutions`, which records
    // the provisioning admin and the POC link server-side.

    async getInstitution(userId: string) {
        const institutionId = await resolveInstitutionIdForUser(supabase, userId);

        if (!institutionId) {
            return { data: null, error: null };
        }

        const { data, error } = await supabase
            .from('institutions')
            .select('*')
            .eq('id', institutionId)
            .single();
        return { data, error };
    },

    async updateInstitutionWallet(institutionId: string, walletAddress: string) {
        const { data, error } = await supabase
            .from('institutions')
            .update({ wallet_address: walletAddress })
            .eq('id', institutionId)
            .select()
            .single();
        return { data, error };
    },

    // Students
    async createStudent(userId: string, name: string, email: string) {
        const { data, error } = await supabase
            .from('students')
            .insert([{ auth_user_id: userId, name, email }])
            .select()
            .single();
        return { data, error };
    },

    async getStudent(userId: string) {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .eq('auth_user_id', userId)
            .single();
        return { data, error };
    },

    async getStudentByWallet(walletAddress: string) {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .eq('wallet_address', walletAddress)
            .single();
        return { data, error };
    },

    async updateStudentWallet(studentId: string, walletAddress: string) {
        const { data, error } = await supabase
            .from('students')
            .update({ wallet_address: walletAddress })
            .eq('id', studentId)
            .select()
            .single();
        return { data, error };
    },

    // Credentials
    async createCredential(credential: {
        student_id: string;
        institution_id: string;
        token_id: string;
        ipfs_hash: string;
        blockchain_hash: string;
        metadata: unknown;
        metadata_schema_version?: number;
        hash_algorithm?: string;
    }) {
        const { data, error } = await supabase
            .from('credentials')
            .insert([credential])
            .select()
            .single();
        return { data, error };
    },

    async getCredentialsByStudent(studentId: string) {
        const { data, error } = await supabase
            .from('credentials')
            .select(
                `
        *,
        institutions (
          id,
          name,
          email
        )
      `,
            )
            .eq('student_id', studentId)
            .eq('revoked', false)
            .order('issued_at', { ascending: false });
        return { data, error };
    },

    async getCredentialsByInstitution(institutionId: string) {
        const { data, error } = await supabase
            .from('credentials')
            .select(
                `
        *,
        students (
          id,
          name,
          email
        )
      `,
            )
            .eq('institution_id', institutionId)
            .order('issued_at', { ascending: false });
        return { data, error };
    },

    async getCredentialByTokenId(tokenId: string) {
        const { data, error } = await supabase
            .from('credentials')
            .select(
                `
        *,
        institutions (
          id,
          name,
          email,
          wallet_address
        ),
        students (
          id,
          name,
          email
        )
      `,
            )
            .eq('token_id', tokenId)
            .single();
        return { data, error };
    },

    async revokeCredential(credentialId: string) {
        const { data, error } = await supabase
            .from('credentials')
            .update({ revoked: true, revoked_at: new Date().toISOString() })
            .eq('id', credentialId)
            .select()
            .single();
        return { data, error };
    },

    // Verification logs
    async createVerificationLog(log: {
        credential_id: string;
        verifier_email?: string;
        verifier_org?: string;
        verification_result: unknown;
    }) {
        const { data, error } = await supabase
            .from('verification_logs')
            .insert([log])
            .select()
            .single();
        return { data, error };
    },
};
