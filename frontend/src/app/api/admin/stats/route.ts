import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { VERIFICATION_RESULT_TYPES } from '@/lib/verificationAudit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const ADMIN_STATS_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'admin-stats',
} as const;

export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, ADMIN_STATS_RATE_LIMIT);
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

        // Fetch total institutions
        const { count: totalInstitutions, error: institutionsError } = await supabase
            .from('institutions')
            .select('*', { count: 'exact', head: true });

        if (institutionsError) {
            structuredLog('ERROR', 'Error fetching institutions', requestId, { error: institutionsError });
        }

        // Fetch authorized institutions (those with wallet_address or verified status)
        // An institution is considered authorized if:
        // 1. They have a wallet_address set, OR
        // 2. They have issued at least one credential

        // First, get institutions with wallet addresses
        const { data: institutionsWithWallet, error: walletError } = await supabase
            .from('institutions')
            .select('id')
            .not('wallet_address', 'is', null);

        if (walletError) {
            structuredLog('ERROR', 'Error fetching institutions with wallet', requestId, { error: walletError });
        }

        // Second, get institutions that have issued credentials
        const { data: institutionsWithCredentials, error: credsError } = await supabase
            .from('credentials')
            .select('institution_id');

        if (credsError) {
            structuredLog('ERROR', 'Error fetching institutions with credentials', requestId, { error: credsError });
        }

        // Combine and deduplicate
        const authorizedInstitutionIds = new Set([
            ...(institutionsWithWallet?.map((i) => i.id) || []),
            ...(institutionsWithCredentials?.map((c) => c.institution_id) || []),
        ]);

        const authorizedInstitutions = authorizedInstitutionIds.size;

        // Fetch total credentials
        const { count: totalCredentials, error: credentialsError } = await supabase
            .from('credentials')
            .select('*', { count: 'exact', head: true });

        if (credentialsError) {
            structuredLog('ERROR', 'Error fetching credentials', requestId, { error: credentialsError });
        }

        // Fetch active (non-revoked) credentials
        const { count: activeCredentials, error: activeError } = await supabase
            .from('credentials')
            .select('*', { count: 'exact', head: true })
            .eq('revoked', false);

        if (activeError) {
            structuredLog('ERROR', 'Error fetching active credentials', requestId, { error: activeError });
        }

        // Fetch total students
        const { count: totalStudents, error: studentsError } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true });

        if (studentsError) {
            structuredLog('ERROR', 'Error fetching students', requestId, { error: studentsError });
        }

        // Fetch aggregate public verification activity. This route is admin-only,
        // so maintainers can monitor volume without exposing raw log rows publicly.
        const { count: totalVerificationAttempts, error: verificationTotalError } =
            await supabase
                .from('verification_logs')
                .select('*', { count: 'exact', head: true });

        if (verificationTotalError) {
            structuredLog('ERROR', 'Error fetching verification log count', requestId, { error: verificationTotalError });
        }

        const verificationSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: verificationAttemptsLast24h, error: verificationRecentError } =
            await supabase
                .from('verification_logs')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', verificationSince);

        if (verificationRecentError) {
            structuredLog('ERROR', 'Error fetching recent verification log count', requestId, { error: verificationRecentError });
        }

        const verificationResultEntries = await Promise.all(
            VERIFICATION_RESULT_TYPES.map(async (resultType) => {
                const { count, error } = await supabase
                    .from('verification_logs')
                    .select('*', { count: 'exact', head: true })
                    .eq('verification_result->>result_type', resultType);

                if (error) {
                    structuredLog('ERROR', `Error fetching ${resultType} verification count`, requestId, { error });
                }

                return [resultType, count || 0] as const;
            }),
        );

        const verificationResultCounts = Object.fromEntries(verificationResultEntries) as Record<
            (typeof VERIFICATION_RESULT_TYPES)[number],
            number
        >;

        return NextResponse.json({
            success: true,
            stats: {
                totalInstitutions: totalInstitutions || 0,
                authorizedInstitutions: authorizedInstitutions || 0,
                totalCredentials: totalCredentials || 0,
                activeCredentials: activeCredentials || 0,
                totalStudents: totalStudents || 0,
                verificationActivity: {
                    totalAttempts: totalVerificationAttempts || 0,
                    attemptsLast24h: verificationAttemptsLast24h || 0,
                    resultCounts: verificationResultCounts,
                },
            },
        });
    } catch (error) {
        captureException(error, { requestId, context: 'GET /api/admin/stats' });
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch statistics',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 },
        );
    }
}
