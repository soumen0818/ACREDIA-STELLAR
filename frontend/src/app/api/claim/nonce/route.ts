import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { enforceRateLimit, getClientIp } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { hashAuditValue } from '@/lib/verificationAudit';
import { isValidStellarAddress } from '@/lib/contracts';
import { buildClaimMessage, CLAIM_NONCE_TTL_SECONDS } from '@/lib/walletOwnership';

export const dynamic = 'force-dynamic';

// Unauthenticated by necessity — the caller has no account yet, which is the
// entire point of claiming — so the limit is tighter than an authed route's.
const CLAIM_NONCE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'claim-nonce',
} as const;

const requestSchema = z.object({
    walletAddress: z.string().trim().refine(isValidStellarAddress, 'Not a valid Stellar address'),
});

/**
 * Issues a single-use, short-lived challenge bound to one wallet address.
 *
 * The nonce is generated and stored server-side; a client-supplied challenge
 * is never accepted. Issuing one reveals nothing — it does not confirm whether
 * the wallet holds any credential, so this endpoint cannot be used to probe
 * which wallets exist in the system.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, CLAIM_NONCE_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const body = await request.json().catch(() => ({}));
        const parsed = requestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: 'A valid Stellar wallet address is required' },
                { status: 400 },
            );
        }

        const { walletAddress } = parsed.data;
        const supabase = getServiceRoleClient();

        const nonce = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + CLAIM_NONCE_TTL_SECONDS * 1000);

        const { error: insertError } = await supabase.from('wallet_claim_nonces').insert({
            wallet_address: walletAddress,
            nonce,
            expires_at: expiresAt.toISOString(),
            ip_hash: hashAuditValue(getClientIp(request)),
        });

        if (insertError) {
            structuredLog('ERROR', 'Failed to store claim nonce', requestId, {
                error: insertError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to start the claim' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            nonce,
            message: buildClaimMessage(walletAddress, nonce),
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error) {
        captureException(error, { context: 'claimNonce', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to start the claim' },
            { status: 500 },
        );
    }
}
