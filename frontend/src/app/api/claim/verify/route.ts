import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { enforceRateLimit, getClientIp } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { hashAuditValue } from '@/lib/verificationAudit';
import { isValidStellarAddress } from '@/lib/contracts';
import { buildClaimMessage, verifyWalletSignature } from '@/lib/walletOwnership';

export const dynamic = 'force-dynamic';

const CLAIM_VERIFY_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'claim-verify',
} as const;

const requestSchema = z.object({
    walletAddress: z.string().trim().refine(isValidStellarAddress, 'Not a valid Stellar address'),
    nonce: z.string().trim().min(32).max(128),
    signature: z.string().trim().min(1).max(512),
    email: z.string().trim().email('A valid email address is required').max(254),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

/** Deliberately vague: a claim failure must not reveal which wallets hold credentials. */
const GENERIC_FAILURE = 'We could not verify ownership of that wallet.';

/**
 * Completes a wallet-ownership claim (Issue #243).
 *
 * Order matters here. The signature is verified before any lookup that could
 * leak information, and the nonce is consumed before the account is created,
 * so a replayed request cannot produce a second account.
 *
 * An email and password are collected so the resulting account is recoverable
 * through the ordinary reset flow: the wallet proves ownership once, it is not
 * the ongoing login credential. Losing the wallet must not lose the account.
 *
 * Claiming grants no issuing rights. The student's wallet is their own and is
 * never authorized as an issuer.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    const ipHash = hashAuditValue(getClientIp(request));

    try {
        const rateLimitResponse = await enforceRateLimit(request, CLAIM_VERIFY_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const body = await request.json().catch(() => ({}));
        const parsed = requestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid claim request', details: parsed.error.flatten() },
                { status: 400 },
            );
        }

        const { walletAddress, nonce, signature, email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();
        const supabase = getServiceRoleClient();

        const audit = async (action: string, outcome: string, extra: Record<string, unknown> = {}) => {
            const { error } = await supabase.from('admin_audit_logs').insert({
                action,
                ip_hash: ipHash,
                details: { walletAddress, outcome, ...extra },
            });
            if (error) {
                structuredLog('WARN', 'Failed to audit claim attempt', requestId, { error });
            }
        };

        // 1. The nonce must exist, be unconsumed, unexpired, and bound to this
        //    exact wallet. Matching on wallet_address here is what stops a
        //    nonce issued for one wallet being spent on another.
        const { data: nonceRow, error: nonceError } = await supabase
            .from('wallet_claim_nonces')
            .select('id, wallet_address, expires_at, consumed_at')
            .eq('nonce', nonce)
            .eq('wallet_address', walletAddress)
            .maybeSingle();

        if (nonceError) {
            structuredLog('ERROR', 'Failed to load claim nonce', requestId, { error: nonceError });
            return NextResponse.json(
                { success: false, error: 'Failed to complete the claim' },
                { status: 500 },
            );
        }

        if (!nonceRow || nonceRow.consumed_at || new Date(nonceRow.expires_at) < new Date()) {
            await audit('claim_wallet_attempt', 'invalid_or_expired_nonce');
            return NextResponse.json(
                { success: false, error: 'This challenge has expired. Start the claim again.' },
                { status: 400 },
            );
        }

        // 2. Verify the signature server-side before anything else is revealed.
        const expectedMessage = buildClaimMessage(walletAddress, nonce);

        if (!verifyWalletSignature(walletAddress, expectedMessage, signature)) {
            await audit('claim_wallet_attempt', 'bad_signature');
            return NextResponse.json({ success: false, error: GENERIC_FAILURE }, { status: 401 });
        }

        // 3. Consume the nonce immediately on a valid signature. Doing this
        //    before account creation means a replay of the same request finds
        //    the challenge already spent instead of creating a second account.
        const { data: consumed, error: consumeError } = await supabase
            .from('wallet_claim_nonces')
            .update({ consumed_at: new Date().toISOString() })
            .eq('id', nonceRow.id)
            .is('consumed_at', null)
            .select('id')
            .maybeSingle();

        if (consumeError || !consumed) {
            // Lost the race against a concurrent request for the same nonce.
            await audit('claim_wallet_attempt', 'nonce_already_consumed');
            return NextResponse.json(
                { success: false, error: 'This challenge has already been used.' },
                { status: 409 },
            );
        }

        // 4. A credential must exist for this wallet. Without it, anyone with
        //    any Stellar wallet could mint themselves an account.
        const { data: credential, error: credentialError } = await supabase
            .from('credentials')
            .select('id, student_id')
            .eq('student_wallet_address', walletAddress)
            .limit(1)
            .maybeSingle();

        if (credentialError) {
            structuredLog('ERROR', 'Failed to check credentials for claim', requestId, {
                error: credentialError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to complete the claim' },
                { status: 500 },
            );
        }

        if (!credential) {
            await audit('claim_wallet_attempt', 'no_credential_for_wallet');
            return NextResponse.json({ success: false, error: GENERIC_FAILURE }, { status: 404 });
        }

        // 5. Collision handling. A wallet already attached to an account has
        //    been claimed; failing here is what stops a second identity being
        //    created for the same person.
        const { data: existingStudent } = await supabase
            .from('students')
            .select('id, email, auth_user_id, institution_id, status')
            .eq('wallet_address', walletAddress)
            .maybeSingle();

        if (existingStudent?.auth_user_id) {
            await audit('claim_wallet_attempt', 'wallet_already_claimed', {
                studentId: existingStudent.id,
            });
            return NextResponse.json(
                {
                    success: false,
                    error: 'This wallet has already been claimed. Sign in, or reset your password if you have lost access.',
                },
                { status: 409 },
            );
        }

        // 6. Create the auth user. A pre-existing account on this email is a
        //    collision too: the claimer may not be that account's owner.
        const { data: created, error: createError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password,
            email_confirm: true,
            user_metadata: { role: 'student', claimedWallet: walletAddress },
        });

        if (createError || !created.user) {
            const alreadyExists = createError?.message.toLowerCase().includes('already');
            await audit('claim_wallet_attempt', alreadyExists ? 'email_taken' : 'user_create_failed');

            return NextResponse.json(
                {
                    success: false,
                    error: alreadyExists
                        ? 'An account already exists for that email address. Sign in instead, then link your wallet.'
                        : 'Failed to create your account.',
                },
                { status: alreadyExists ? 409 : 500 },
            );
        }

        const authUserId = created.user.id;

        await supabase.from('profiles').upsert(
            {
                id: authUserId,
                email: normalizedEmail,
                role: 'student',
                is_active: true,
            },
            { onConflict: 'id' },
        );

        // 7. Attach to the existing student record rather than duplicating it,
        //    so an institution-provisioned student keeps their roster identity,
        //    their student id, and their institution.
        let studentId: string;

        if (existingStudent) {
            const { data: attached, error: attachError } = await supabase
                .from('students')
                .update({
                    auth_user_id: authUserId,
                    status: 'active',
                    claimed_at: new Date().toISOString(),
                    invite_accepted_at: new Date().toISOString(),
                })
                .eq('id', existingStudent.id)
                .select('id')
                .single();

            if (attachError || !attached) {
                structuredLog('ERROR', 'Failed to attach claim to student record', requestId, {
                    error: attachError,
                });
                return NextResponse.json(
                    { success: false, error: 'Failed to complete the claim' },
                    { status: 500 },
                );
            }

            studentId = attached.id;
        } else {
            const { data: newStudent, error: newStudentError } = await supabase
                .from('students')
                .insert({
                    auth_user_id: authUserId,
                    name: normalizedEmail.split('@')[0],
                    email: normalizedEmail,
                    wallet_address: walletAddress,
                    status: 'active',
                    provisioning_origin: 'claim',
                    claimed_at: new Date().toISOString(),
                })
                .select('id')
                .single();

            if (newStudentError || !newStudent) {
                structuredLog('ERROR', 'Failed to create student record for claim', requestId, {
                    error: newStudentError,
                });
                return NextResponse.json(
                    { success: false, error: 'Failed to complete the claim' },
                    { status: 500 },
                );
            }

            studentId = newStudent.id;
        }

        // Backfill the credential's student_id where issuance only ever knew a
        // wallet address, so the student's dashboard can find it.
        await supabase
            .from('credentials')
            .update({ student_id: studentId })
            .eq('student_wallet_address', walletAddress)
            .is('student_id', null);

        await audit('claim_wallet_success', 'claimed', {
            studentId,
            attachedToExisting: Boolean(existingStudent),
        });

        structuredLog('INFO', 'Wallet claim completed', requestId, {
            studentId,
            attachedToExisting: Boolean(existingStudent),
        });

        return NextResponse.json({
            success: true,
            email: normalizedEmail,
            message: 'Your account is ready. Sign in to see your credentials.',
        });
    } catch (error) {
        captureException(error, { context: 'claimVerify', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to complete the claim' },
            { status: 500 },
        );
    }
}
