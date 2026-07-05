import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { resolveUserRole } from './roleResolver';
import { runtimeConfig, serverRuntimeConfig } from './runtimeConfig';

const supabaseUrl = runtimeConfig.supabase.url;
const supabaseAnonKey = runtimeConfig.supabase.anonKey;
const supabaseServiceRoleKey = serverRuntimeConfig.auth.serviceRoleKey;
const adminEmailAllowlist = serverRuntimeConfig.admin.emailAllowlist.join(',');

export function isTrustedAdminEmail(email: string, allowlist = adminEmailAllowlist || ''): boolean {
    const allowedEmails = allowlist
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

    if (allowedEmails.length === 0) {
        return false;
    }

    return allowedEmails.includes(email.toLowerCase());
}

function getBearerToken(request: NextRequest): string | null {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token;
}

function hasPublicEnv(): boolean {
    return Boolean(supabaseUrl && supabaseAnonKey);
}

export function hasServiceRoleEnv(): boolean {
    return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function createAnonClient() {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
            'Missing Supabase public environment variables. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        );
    }

    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

function createServiceRoleClient() {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error(
            'Missing Supabase service role configuration. Set SUPABASE_SERVICE_ROLE_KEY for admin routes.',
        );
    }

    if (runtimeConfig.isProduction && !supabaseServiceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in production for admin routes.');
    }

    return createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

export async function requireAdminRequest(
    request: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
    if (!hasServiceRoleEnv()) {
        return {
            ok: false,
            status: 500,
            error: 'Server configuration error',
        };
    }

    const authCheck = await requireAuthenticatedRequest(request);
    if (!authCheck.ok) {
        return authCheck;
    }

    const serviceClient = createServiceRoleClient();
    const { data: authUser, error: userError } = await serviceClient.auth.admin.getUserById(
        authCheck.userId,
    );

    if (userError || !authUser.user?.email) {
        return {
            ok: false,
            status: 401,
            error: 'Invalid admin user',
        };
    }

    if (!isTrustedAdminEmail(authUser.user.email)) {
        return {
            ok: false,
            status: 403,
            error: 'Admin account is not trusted for this deployment',
        };
    }

    const role = await resolveUserRole(serviceClient, authUser.user);

    if (role !== 'admin') {
        return {
            ok: false,
            status: 403,
            error: 'Admin access required',
        };
    }

    return {
        ok: true,
        userId: authCheck.userId,
    };
}

export async function requireAuthenticatedRequest(
    request: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
    if (!hasPublicEnv()) {
        return {
            ok: false,
            status: 500,
            error: 'Server configuration error',
        };
    }

    const token = getBearerToken(request);
    if (!token) {
        return {
            ok: false,
            status: 401,
            error: 'Missing access token',
        };
    }

    const anonClient = createAnonClient();
    const { data: authData, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !authData.user) {
        return {
            ok: false,
            status: 401,
            error: 'Invalid or expired access token',
        };
    }

    return {
        ok: true,
        userId: authData.user.id,
    };
}

export function getServiceRoleClient() {
    return createServiceRoleClient();
}

export function createUserScopedServerClient(accessToken: string) {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
            'Missing Supabase public environment variables. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        );
    }

    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}
