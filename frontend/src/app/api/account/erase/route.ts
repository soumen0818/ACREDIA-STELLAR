import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedRequest, getServiceRoleClient } from '@/lib/serverAuth';
import { unpinFromPinata } from '@/lib/ipfsServer';
import { captureException } from '@/lib/debug';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const ACCOUNT_ERASE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 5,
    prefix: 'account-erase',
} as const;

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/**
 * Writes an audit record for every institution membership this user holds,
 * before the auth user is deleted and the rows cascade away.
 *
 * Deliberately best-effort: an erasure request is a legal obligation and must
 * not fail because the audit write did. Failures are captured for follow-up.
 */
async function recordMembershipRemoval(
    serviceClient: ServiceClient,
    userId: string,
    requestId: string,
): Promise<void> {
    try {
        const { data: memberships } = await serviceClient
            .from('institution_users')
            .select('institution_id, role, status')
            .eq('auth_user_id', userId);

        if (!memberships?.length) {
            return;
        }

        for (const membership of memberships) {
            // Count the members that will remain once this one is gone, so a
            // newly-orphaned institution is visible in the audit trail.
            const { count: remainingActive } = await serviceClient
                .from('institution_users')
                .select('id', { count: 'exact', head: true })
                .eq('institution_id', membership.institution_id)
                .eq('status', 'active')
                .neq('auth_user_id', userId);

            await serviceClient.from('admin_audit_logs').insert({
                action: 'deactivate_account',
                target_institution_id: membership.institution_id,
                previous_poc_id: userId,
                details: {
                    reason: 'gdpr_erasure',
                    removed_role: membership.role,
                    removed_status: membership.status,
                    remaining_active_members: remainingActive ?? 0,
                    // The signal an operator needs: this institution can no
                    // longer issue until a new member is provisioned.
                    institution_left_without_members: (remainingActive ?? 0) === 0,
                },
            });
        }
    } catch (error) {
        captureException(error, {
            requestId,
            context: 'POST /api/account/erase - recordMembershipRemoval',
        });
    }
}

/**
 * POST /api/account/erase
 *
 * GDPR Art. 17 — Right to erasure ("right to be forgotten").
 *
 * Steps:
 *   1. Authenticate the caller.
 *   2. Insert an erasure_request row and lock processing.
 *   3. Fetch all IPFS CIDs associated with this user's credentials and
 *      unpin them from Pinata (best-effort — individual failures logged).
 *   4. Call process_erasure() DB function to redact PII columns.
 *   5. Delete the Supabase auth user (cascades to profiles FK).
 *
 * On-chain data (blockchain_hash, token_id) is NOT deleted; it is not
 * personal data under GDPR — it is a one-way hash pointer. This is
 * documented in docs/legal/data-model.md and the Privacy Policy.
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

        const { userId } = authCheck;
        const serviceClient = getServiceRoleClient();

        // 2. Create an erasure request record.
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

        // 3. Fetch IPFS hashes for this user's credentials.
        const { data: student } = await serviceClient
            .from('students')
            .select('id')
            .eq('auth_user_id', userId)
            .maybeSingle();

        if (student?.id) {
            const { data: creds } = await serviceClient
                .from('credentials')
                .select('ipfs_hash')
                .eq('student_id', student.id);

            if (creds && creds.length > 0) {
                const unpinResults = await Promise.allSettled(
                    creds.map((c: { ipfs_hash: string }) => unpinFromPinata(c.ipfs_hash)),
                );
                // Log individual unpin failures but don't abort — DB erasure must still proceed.
                unpinResults.forEach((result, idx) => {
                    if (result.status === 'rejected') {
                        captureException(
                            new Error(`Unpin failed for CID ${creds[idx].ipfs_hash}: ${result.reason}`),
                            { requestId, context: 'POST /api/account/erase - unpin' },
                        );
                    }
                });
            }
        }

        // 4. Run the DB PII scrub function (service_role — bypasses RLS).
        const { error: scrubError } = await serviceClient.rpc('process_erasure', {
            p_request_id: erasureRequestId,
        });

        if (scrubError) {
            captureException(new Error(`process_erasure RPC failed: ${scrubError.message}`), {
                requestId,
                context: 'POST /api/account/erase - process_erasure',
            });
            // Mark the erasure request as failed so admin can retry.
            await serviceClient
                .from('erasure_requests')
                .update({ status: 'failed', failure_reason: scrubError.message })
                .eq('id', erasureRequestId);

            return NextResponse.json(
                { success: false, error: 'Erasure processing failed. Please contact support.' },
                { status: 500 },
            );
        }

        // Issue #232: explicitly unlink the auth_user_id from business records
        // before deleting the auth user, ensuring no cascade can possibly occur
        // even if foreign keys are mis-configured.
        await Promise.all([
            serviceClient
                .from('institutions')
                .update({ auth_user_id: null, status: 'suspended' })
                .eq('auth_user_id', userId),
            serviceClient
                .from('students')
                .update({ auth_user_id: null })
                .eq('auth_user_id', userId),
        ]);

        // `institution_users.auth_user_id` is ON DELETE CASCADE, so deleting the
        // auth user below silently removes every membership row. That is safe
        // for credentials, but it erases the record of who held issuing rights —
        // which must remain auditable, because a credential issued in the past
        // was signed under that authority. Capture it first.
        //
        // This also surfaces the continuity risk: if the erased user was the
        // institution's only active member, nobody can issue for it any more and
        // an admin has to re-provision a POC. That is recorded rather than left
        // to be discovered when issuance fails.
        await recordMembershipRemoval(serviceClient, userId, requestId);

        // 5. Delete the auth user — cascades to profiles via FK, but business records survive.
        const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(userId);

        if (deleteAuthError) {
            // PII is already scrubbed from DB; auth deletion failure is recoverable.
            captureException(
                new Error(`Auth user delete failed: ${deleteAuthError.message}`),
                { requestId, context: 'POST /api/account/erase - deleteUser' },
            );
            // Don't return an error to the user — their data is already gone.
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
