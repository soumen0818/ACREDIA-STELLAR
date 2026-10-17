import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient, requireAuthenticatedRequest } from './serverAuth';
import {
    canManageMembers,
    resolveInstitutionForUser,
    type InstitutionRole,
} from './institutionMembership';

export type MemberRouteAuth =
    | {
          ok: true;
          client: SupabaseClient;
          userId: string;
          email: string | null;
          institutionId: string;
          role: InstitutionRole;
          canManage: boolean;
      }
    | { ok: false; status: number; error: string };

/**
 * Authenticates a team-management request and resolves the caller's
 * institution from their own active membership — never from the request — so
 * no caller can act on another institution's team (Issue #307).
 *
 * `manage: true` additionally requires a role that may manage members.
 */
export async function requireInstitutionMemberRequest(
    request: NextRequest,
    { manage = false }: { manage?: boolean } = {},
): Promise<MemberRouteAuth> {
    const authCheck = await requireAuthenticatedRequest(request);
    if (!authCheck.ok) return authCheck;

    const client = getServiceRoleClient();
    const membership = await resolveInstitutionForUser(client, authCheck.userId);

    if (!membership) {
        return { ok: false, status: 403, error: 'You are not an active member of an institution.' };
    }

    const canManage = canManageMembers(membership.role);
    if (manage && !canManage) {
        return {
            ok: false,
            status: 403,
            error: "Only your institution's owners can manage its members.",
        };
    }

    return {
        ok: true,
        client,
        userId: authCheck.userId,
        email: authCheck.user.email ?? null,
        institutionId: membership.institutionId,
        role: membership.role,
        canManage,
    };
}

/** Where an emailed member invitation lands. */
export function memberInviteRedirect(request: NextRequest): string {
    const origin = request.nextUrl.origin || 'http://localhost:3000';
    return `${origin}/auth/accept-invite?next=/dashboard`;
}
