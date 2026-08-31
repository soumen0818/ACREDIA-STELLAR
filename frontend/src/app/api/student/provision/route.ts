import { NextRequest, NextResponse } from 'next/server';
import {
    getServiceRoleClient,
    requireAuthenticatedRequest,
} from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

/**
 * Links a signed-in student account to its existing student record.
 *
 * Since Issue #239 removed self-registration this route only ever *links* —
 * it adopts a record an institution provisioned (Issue #241) or a claim
 * created (Issue #243), and returns 404 when there is nothing to adopt.
 */

const STUDENT_PROVISION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'student-provision',
} as const;

export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = await enforceRateLimit(request, STUDENT_PROVISION_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            );
        }

        const serviceClient = getServiceRoleClient();
        const { data: authUser, error: authError } = await serviceClient.auth.admin.getUserById(
            authCheck.userId,
        );

        if (authError || !authUser?.user) {
            structuredLog('ERROR', 'Error fetching auth user', requestId, { error: authError });
            return NextResponse.json(
                { success: false, error: 'Failed to retrieve auth user details' },
                { status: 400 },
            );
        }

        // Enforce email verification before linking / provisioning
        const emailConfirmedAt = authUser.user.email_confirmed_at;
        if (!emailConfirmedAt) {
            return NextResponse.json(
                { success: false, error: 'Email verification is required before provisioning/linking your student profile.' },
                { status: 403 },
            );
        }

        const userEmail = authUser.user.email ?? '';
        if (!userEmail) {
            return NextResponse.json(
                { success: false, error: 'User email is missing' },
                { status: 400 },
            );
        }

        // 1. Check if a student profile already exists for this auth_user_id
        const { data: existingByAuth, error: fetchAuthError } = await serviceClient
            .from('students')
            .select('id, email, auth_user_id, wallet_address')
            .eq('auth_user_id', authCheck.userId)
            .maybeSingle();

        if (fetchAuthError) {
            structuredLog('ERROR', 'Error fetching student by auth_user_id', requestId, { error: fetchAuthError });
            return NextResponse.json(
                { success: false, error: 'Database error' },
                { status: 500 },
            );
        }

        if (existingByAuth) {
            return NextResponse.json({ success: true, student: existingByAuth });
        }

        // 2. Check if a student profile already exists with this email
        const { data: existingByEmail, error: fetchEmailError } = await serviceClient
            .from('students')
            .select('id, email, auth_user_id, wallet_address')
            .eq('email', userEmail)
            .maybeSingle();

        if (fetchEmailError) {
            structuredLog('ERROR', 'Error fetching student by email', requestId, { error: fetchEmailError });
            return NextResponse.json(
                { success: false, error: 'Database error' },
                { status: 500 },
            );
        }

        if (existingByEmail) {
            // NEVER adopt a row belonging to a different auth_user_id
            if (existingByEmail.auth_user_id && existingByEmail.auth_user_id !== authCheck.userId) {
                return NextResponse.json(
                    { success: false, error: 'This email address is already linked to another student account.' },
                    { status: 409 },
                );
            }

            // If the matching student row has a NULL auth_user_id, we can safely link/adopt it
            const { data: updatedStudent, error: updateError } = await serviceClient
                .from('students')
                .update({ auth_user_id: authCheck.userId })
                .eq('id', existingByEmail.id)
                .select('id, email, auth_user_id, wallet_address')
                .maybeSingle();

            if (updateError || !updatedStudent) {
                structuredLog('ERROR', 'Error linking student profile', requestId, { error: updateError });
                return NextResponse.json(
                    { success: false, error: 'Failed to link student profile' },
                    { status: 500 },
                );
            }

            return NextResponse.json({ success: true, student: updatedStudent });
        }

        // 3. No student record exists for this account.
        //
        //    This route links an account to a record that already exists; it no
        //    longer creates one. Self-registration was removed in Issue #239,
        //    and a student record is created either by their institution
        //    (Issue #241) or by a wallet-ownership claim (Issue #243). Creating
        //    one here would reopen exactly the hole those issues closed.
        structuredLog('INFO', 'No student record to link for account', requestId, {
            userId: authCheck.userId,
        });

        return NextResponse.json(
            {
                success: false,
                error: 'No student record is linked to this account. Ask your institution to add you, or claim your credentials with the wallet they were issued to.',
                claimUrl: '/claim',
            },
            { status: 404 },
        );
    } catch (err) {
        captureException(err, { requestId, context: 'POST /api/student/provision' });
        return NextResponse.json(
            { success: false, error: 'Failed to provision student profile' },
            { status: 500 },
        );
    }
}
