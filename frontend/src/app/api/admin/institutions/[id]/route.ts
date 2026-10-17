import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import type { ContinuityAssessment } from '@/lib/institutionContinuity';
import { listInstitutionTeam, type InstitutionMemberView } from '@/lib/institutionMembers';

export const dynamic = 'force-dynamic';

const ADMIN_INSTITUTION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'admin-institution',
} as const;

const idSchema = z.string().uuid();

const CREDENTIAL_PAGE_SIZE = 50;

/**
 * Returns one institution plus its most recent credentials, for the admin
 * institution detail page.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ADMIN_INSTITUTION_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const adminCheck = await requireAdminRequest(request);
        if (!adminCheck.ok) {
            return NextResponse.json(
                { success: false, error: adminCheck.error },
                { status: adminCheck.status },
            );
        }

        const { id } = await context.params;
        const parsedId = idSchema.safeParse(id);

        if (!parsedId.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid institution id' },
                { status: 400 },
            );
        }

        const supabase = getServiceRoleClient();

        const { data: institution, error: institutionError } = await supabase
            .from('institutions')
            .select(
                'id, name, email, wallet_address, verified, status, authorization_tx_hash, auth_user_id, created_at',
            )
            .eq('id', parsedId.data)
            .maybeSingle();

        if (institutionError) {
            structuredLog('ERROR', 'Error fetching institution', requestId, {
                error: institutionError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to load institution' },
                { status: 500 },
            );
        }

        if (!institution) {
            return NextResponse.json(
                { success: false, error: 'Institution not found' },
                { status: 404 },
            );
        }

        // Fetch POC profile if auth_user_id exists
        let pocProfile: {
            id: string;
            fullName: string | null;
            email: string | null;
            isActive: boolean;
            deactivatedAt: string | null;
            deactivatedReason: string | null;
        } | null = null;

        if (institution.auth_user_id) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('id, full_name, email, is_active, deactivated_at, deactivated_reason')
                .eq('id', institution.auth_user_id)
                .maybeSingle();

            if (profile) {
                pocProfile = {
                    id: profile.id,
                    fullName: profile.full_name ?? null,
                    email: profile.email ?? institution.email,
                    isActive: profile.is_active !== false,
                    deactivatedAt: profile.deactivated_at ?? null,
                    deactivatedReason: profile.deactivated_reason ?? null,
                };
            }
        }

        // Fetch admin audit logs for this institution
        const { data: auditLogs, error: auditLogsError } = await supabase
            .from('admin_audit_logs')
            .select(
                'id, action, actor_admin_id, requester_email, previous_poc_email, new_poc_email, details, created_at',
            )
            .eq('target_institution_id', parsedId.data)
            .order('created_at', { ascending: false })
            .limit(20);

        if (auditLogsError) {
            structuredLog('WARN', 'Error fetching audit logs for institution', requestId, {
                error: auditLogsError,
            });
        }

        const { data: credentials, error: credentialsError } = await supabase
            .from('credentials')
            .select('id, token_id, student_wallet_address, issued_at, revoked, revoked_at, metadata')
            .eq('institution_id', parsedId.data)
            .order('issued_at', { ascending: false })
            .limit(CREDENTIAL_PAGE_SIZE);

        if (credentialsError) {
            structuredLog('ERROR', 'Error fetching institution credentials', requestId, {
                error: credentialsError,
            });
        }

        const rows = credentials ?? [];

        // The team behind the institution, so an admin handling a recovery
        // request can see who else could act (Issue #307). Degrades to an
        // empty team rather than failing the page.
        let team: { members: InstitutionMemberView[]; continuity: ContinuityAssessment } | Record<string, never> = {};
        try {
            team = await listInstitutionTeam(supabase, parsedId.data, null);
        } catch (teamError) {
            structuredLog('WARN', 'Error fetching institution team', requestId, { error: teamError });
        }

        return NextResponse.json({
            success: true,
            institution: {
                id: institution.id,
                name: institution.name,
                email: institution.email,
                walletAddress: institution.wallet_address ?? null,
                verified: Boolean(institution.verified),
                status: institution.status ?? 'pending',
                authorizationTxHash: institution.authorization_tx_hash ?? null,
                createdAt: institution.created_at ?? null,
                credentialCount: rows.length,
                activeCredentialCount: rows.filter((row) => !row.revoked).length,
                poc: pocProfile,
                ...team,
            },
            auditLogs: (auditLogs ?? []).map((log) => ({
                id: log.id,
                action: log.action,
                actorAdminId: log.actor_admin_id ?? null,
                requesterEmail: log.requester_email ?? null,
                previousPocEmail: log.previous_poc_email ?? null,
                newPocEmail: log.new_poc_email ?? null,
                details: log.details ?? {},
                createdAt: log.created_at ?? null,
            })),
            credentials: rows.map((row) => ({
                id: row.id,
                tokenId: row.token_id,
                studentWalletAddress: row.student_wallet_address ?? null,
                issuedAt: row.issued_at ?? null,
                revoked: Boolean(row.revoked),
                revokedAt: row.revoked_at ?? null,
                degree:
                    (row.metadata as Record<string, unknown> | null)?.degree?.toString() ?? null,
            })),
        });
    } catch (error) {
        captureException(error, { context: 'adminInstitutionDetail' });
        return NextResponse.json(
            { success: false, error: 'Failed to load institution' },
            { status: 500 },
        );
    }
}
