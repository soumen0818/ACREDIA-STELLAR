import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import {
    getServiceRoleClient,
    isTrustedAdminEmail,
    requireAuthenticatedRequest,
} from '@/lib/serverAuth';
import { captureException } from '@/lib/debug';
import { enforceRateLimit } from '@/lib/rateLimit';
import { CONTACT_EMAIL } from '@/lib/contact';
import { SELF_DELETION_NOT_AVAILABLE } from '@/lib/accountErasure';

export const dynamic = 'force-dynamic';

const ACCOUNT_ERASE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 5,
    prefix: 'account-erase',
} as const;

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/**
 * Whether this account is tied to an institution or to Acredia
 * administration, in which case self-service deletion is refused.
 *
 * Deleting such an account can leave an institution unable to issue or
 * revoke, and cascades away the record of who held issuing rights. Support
 * removes these accounts deliberately instead, through the Team page or the
 * admin POC handover (docs/support-procedures.md §4).
 *
 * Any tie counts, including a removed membership: its row is the audit record
 * of past issuing authority and would be cascaded away with the account.
 */
async function hasOrganisationalTie(serviceClient: ServiceClient, user: User): Promise<boolean> {
    if (user.email && isTrustedAdminEmail(user.email)) {
        return true;
    }

    const [profile, membership, contact] = await Promise.all([
        serviceClient.from('profiles').select('role').eq('id', user.id).maybeSingle(),
        serviceClient.from('institution_users').select('id').eq('auth_user_id', user.id).limit(1),
        serviceClient.from('institutions').select('id').eq('auth_user_id', user.id).limit(1),
    ]);

    // Fail closed: if any lookup errors, treat the account as tied rather
    // than risk deleting an institution's only issuer.
    if (profile.error || membership.error || contact.error) {
        throw new Error('Could not determine whether the account belongs to an institution.');
    }

    const role = (profile.data as { role?: string } | null)?.role;
    return (
        role === 'admin' ||
        role === 'institution' ||
        (membership.data?.length ?? 0) > 0 ||
        (contact.data?.length ?? 0) > 0
    );
}

/**
 * POST /api/account/erase
 *
 * Self-service account deletion for students (GDPR Art. 17 / DPDP Act).
 *
 * Deletion is account-only: the login, the profile (email, name, notification
 * preferences) and the roster's link to the account. The roster record and
 * the credentials issued against it belong to the institution and stay
 * verifiable; on-chain records are permanent. This is what the Delete screen
 * and the privacy policy tell users.
 *
 * Steps:
 *   1. Authenticate the caller.
 *   2. Refuse institution staff and admins (see hasOrganisationalTie).
 *   3. Record an erasure request (kept 7 years; survives the account).
 *   4. process_erasure(): unlink the roster record, delete the profile.
 *   5. Delete the auth account.
 *
 * Returns 204 No Content on success.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ACCOUNT_ERASE_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        // 1. Authenticate.
        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            );
        }

        const { userId, user } = authCheck;
        const serviceClient = getServiceRoleClient();

        // 2. Students only.
        if (await hasOrganisationalTie(serviceClient, user)) {
            return NextResponse.json(
                {
                    success: false,
                    code: SELF_DELETION_NOT_AVAILABLE,
                    error: `Accounts linked to an institution or to Acredia administration are removed by our support team, so issuing and revoking keep working. Email ${CONTACT_EMAIL} to request removal.`,
                },
                { status: 403 },
            );
        }

        // 3. Create an erasure request record.
        const { data: erasureRow, error: requestErr } = await serviceClient
            .from('erasure_requests')
            .insert({ auth_user_id: userId, status: 'processing' })
            .select('id')
            .single();

        if (requestErr || !erasureRow) {
            captureException(new Error(`Erasure request insert failed: ${requestErr?.message}`), {
                requestId,
                context: 'POST /api/account/erase - insert erasure_request',
            });
            return NextResponse.json(
                { success: false, error: 'Could not initiate erasure request.' },
                { status: 500 },
            );
        }

        const erasureRequestId: string = erasureRow.id;

        // 4. Account-level erasure (service_role — the function is not
        //    callable by clients).
        const { error: scrubError } = await serviceClient.rpc('process_erasure', {
            p_request_id: erasureRequestId,
        });

        if (scrubError) {
            captureException(new Error(`process_erasure RPC failed: ${scrubError.message}`), {
                requestId,
                context: 'POST /api/account/erase - process_erasure',
            });
            // Mark the erasure request as failed so support can retry.
            await serviceClient
                .from('erasure_requests')
                .update({ status: 'failed', failure_reason: scrubError.message })
                .eq('id', erasureRequestId);

            return NextResponse.json(
                { success: false, error: 'Erasure processing failed. Please contact support.' },
                { status: 500 },
            );
        }

        // 5. Delete the auth account. The profile is already gone and the
        //    roster record already unlinked, so nothing else cascades.
        const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(userId);

        if (deleteAuthError) {
            // Personal data is already removed; the leftover login is
            // recoverable by support.
            captureException(new Error(`Auth user delete failed: ${deleteAuthError.message}`), {
                requestId,
                context: 'POST /api/account/erase - deleteUser',
            });
        }

        return new NextResponse(null, { status: 204 });
    } catch (error: unknown) {
        captureException(error, { requestId, context: 'POST /api/account/erase' });
        return NextResponse.json(
            { success: false, error: 'An unexpected error occurred during account erasure.' },
            { status: 500 },
        );
    }
}
