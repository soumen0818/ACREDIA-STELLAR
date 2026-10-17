import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { resolveUserRole } from './roleResolver';
import { runtimeConfig, serverRuntimeConfig } from './runtimeConfig';
import { resolveInstitutionForUser, type InstitutionRole } from './institutionMembership';

type AuthenticatedRequest = {
    ok: true;
    userId: string;
    /** The verified Supabase user, for callers that need role resolution. */
    user: User;
    /** The bearer token that was verified, for building user-scoped clients. */
    accessToken: string;
};

type AuthFailure = { ok: false; status: number; error: string };

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

/**
 * Convenience wrapper around {@link requireAuthenticatedRequest} for routes that
 * only need "is this a signed-in user, and who are they?".
 *
 * Returns `null` instead of a failure object so callers can guard with a simple
 * falsy check and reply `401` themselves.
 */
export async function verifySession(
    request: NextRequest,
): Promise<{ user: User; userId: string; accessToken: string } | null> {
    const authCheck = await requireAuthenticatedRequest(request);
    if (!authCheck.ok) {
        return null;
    }

    return {
        user: authCheck.user,
        userId: authCheck.userId,
        accessToken: authCheck.accessToken,
    };
}

export async function requireAuthenticatedRequest(
    request: NextRequest,
): Promise<AuthenticatedRequest | AuthFailure> {
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
        user: authData.user,
        accessToken: token,
    };
}

/**
 * Guard for routes that only credential **issuers** may call.
 *
 * Authenticates the caller, then resolves their role through the shared
 * {@link resolveUserRole} resolver so this guard can never drift from the role
 * priority documented in `docs/auth-flow.md`. Anything other than `'institution'`
 * — anonymous, student, admin, or unprovisioned — is rejected.
 *
 * Prefers the service-role client so the check does not depend on RLS; falls
 * back to a client scoped to the caller's own access token, where the
 * "view own data" policies still expose the rows the resolver needs.
 */
export async function requireInstitutionRequest(
    request: NextRequest,
): Promise<
    | {
          ok: true;
          userId: string;
          institutionId: string | null;
          memberRole: InstitutionRole | null;
      }
    | { ok: false; status: number; error: string }
> {
    const authCheck = await requireAuthenticatedRequest(request);
    if (!authCheck.ok) {
        return authCheck;
    }

    let client;
    try {
        client = hasServiceRoleEnv()
            ? createServiceRoleClient()
            : createUserScopedServerClient(authCheck.accessToken);
    } catch {
        return {
            ok: false,
            status: 500,
            error: 'Server configuration error',
        };
    }

    const role = await resolveUserRole(client, authCheck.user);

    if (role !== 'institution') {
        return {
            ok: false,
            status: 403,
            error: 'Institution access required',
        };
    }

    // Best-effort: callers use this to scope uploads to the issuing institution.
    // A missing membership is not fatal — `profiles.role` already established
    // the role.
    const membership = await resolveInstitutionForUser(client, authCheck.userId);

    return {
        ok: true,
        userId: authCheck.userId,
        institutionId: membership?.institutionId ?? null,
        // Lets write routes refuse read-only members (`viewer`), which
        // institution owners can now assign themselves (Issue #307).
        memberRole: membership?.role ?? null,
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
