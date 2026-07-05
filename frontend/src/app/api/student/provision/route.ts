import { NextRequest, NextResponse } from 'next/server';
import {
    getServiceRoleClient,
    requireAuthenticatedRequest,
} from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const STUDENT_PROVISION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'student-provision',
} as const;

export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, STUDENT_PROVISION_RATE_LIMIT);
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

        // 3. No existing student profile found, create a new one
        const userName = authUser.user.user_metadata?.name ?? userEmail.split('@')[0] ?? 'Student';
        const { data: newStudent, error: createError } = await serviceClient
            .from('students')
            .insert({
                auth_user_id: authCheck.userId,
                name: userName,
                email: userEmail
            })
            .select('id, email, auth_user_id, wallet_address')
            .maybeSingle();

        if (createError || !newStudent) {
            structuredLog('ERROR', 'Error creating student profile', requestId, { error: createError });
            return NextResponse.json(
                { success: false, error: 'Failed to create student profile' },
                { status: 500 },
            );
        }

        return NextResponse.json({ success: true, student: newStudent });
    } catch (err) {
        captureException(err, { requestId, context: 'POST /api/student/provision' });
        return NextResponse.json(
            { success: false, error: 'Failed to provision student profile' },
            { status: 500 },
        );
    }
}
