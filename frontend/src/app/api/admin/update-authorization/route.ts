import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { verifyAdminAuthorizationTransaction } from '@/lib/adminAuthorizationVerification';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const ADMIN_UPDATE_AUTHORIZATION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'admin-update-authorization',
} as const;

export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, ADMIN_UPDATE_AUTHORIZATION_RATE_LIMIT);
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

        const supabase = getServiceRoleClient();

        const { walletAddress, transactionHash } = await request.json();

        if (!walletAddress) {
            return NextResponse.json(
                { success: false, error: 'Wallet address is required' },
                { status: 400 },
            );
        }

        if (!transactionHash) {
            return NextResponse.json(
                { success: false, error: 'Authorization transaction hash is required' },
                { status: 400 },
            );
        }

        const verification = await verifyAdminAuthorizationTransaction(
            walletAddress,
            transactionHash,
        );
        if (!verification.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: verification.message,
                    code: verification.code,
                },
                { status: verification.status },
            );
        }

        // Find institution by wallet address and update/verify them
        const { data: institution, error: findError } = await supabase
            .from('institutions')
            .select('*')
            .eq('wallet_address', verification.walletAddress)
            .single();

        if (findError && findError.code !== 'PGRST116') {
            structuredLog('ERROR', 'Error finding institution', requestId, { error: findError });
            return NextResponse.json(
                { success: false, error: 'Failed to find institution' },
                { status: 500 },
            );
        }

        if (institution) {
            // Update existing institution to mark as verified and store transaction hash
            const updateData = {
                verified: true,
                authorization_tx_hash: verification.transactionHash,
            };

            const { error: updateError } = await supabase
                .from('institutions')
                .update(updateData)
                .eq('id', institution.id);

            if (updateError) {
                structuredLog('ERROR', 'Error updating institution', requestId, { error: updateError });
                return NextResponse.json(
                    { success: false, error: 'Failed to update institution' },
                    { status: 500 },
                );
            }

            return NextResponse.json({
                success: true,
                message: 'Institution verified successfully',
                institution,
                transactionHash: verification.transactionHash,
            });
        }

        // If no institution found with this wallet, return info but don't fail
        return NextResponse.json({
            success: true,
            message:
                'Wallet authorized on blockchain. Institution will be linked when they connect.',
            wallet: verification.walletAddress,
            transactionHash: verification.transactionHash,
        });
    } catch (error) {
        captureException(error, { requestId, context: 'POST /api/admin/update-authorization' });
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to update authorization',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 },
        );
    }
}
