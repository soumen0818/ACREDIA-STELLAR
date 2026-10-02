import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { captureException, structuredLog } from '@/lib/debug';
import { STALE_AFTER_HOURS, hoursSince, isRetentionStale } from '@/lib/retentionHealth';

export const dynamic = 'force-dynamic';

const ADMIN_RETENTION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'admin-retention',
} as const;

interface RetentionStatus {
    verificationLogs: {
        total: number;
        overdue: number;
        oldest: string | null;
        retentionDays: number;
    };
    contactMessages: {
        total: number;
        overdue: number;
        oldest: string | null;
        retentionMonths: number;
    };
    lastSuccess: {
        finishedAt: string | null;
        rowsDeleted: number | null;
        durationMs: number | null;
        detail: Record<string, number> | null;
    } | null;
    lastFailure: { finishedAt: string | null; error: string | null } | null;
}

/**
 * Retention health for the admin console: how many rows each governed table
 * holds, how many are past their published retention period, and when the
 * purge last succeeded.
 */
export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ADMIN_RETENTION_RATE_LIMIT);
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
        const { data, error } = await supabase.rpc('retention_status');

        if (error) {
            throw new Error(error.message);
        }

        const status = data as RetentionStatus | null;
        if (!status) {
            throw new Error('retention_status() returned no data');
        }

        const stale = isRetentionStale(status.lastSuccess?.finishedAt);
        const overdue =
            (status.verificationLogs?.overdue ?? 0) + (status.contactMessages?.overdue ?? 0);

        // The alert. A stalled purge means the published privacy policy is
        // no longer accurate, so this is logged at ERROR to reach the same
        // observability pipeline as any other production fault.
        if (stale || overdue > 0) {
            structuredLog('ERROR', 'Data retention is not being enforced', requestId, {
                stale,
                hoursSinceLastSuccess: hoursSince(status.lastSuccess?.finishedAt),
                overdueRows: overdue,
                lastFailure: status.lastFailure?.error ?? null,
            });
        }

        return NextResponse.json({
            success: true,
            retention: {
                ...status,
                stale,
                staleAfterHours: STALE_AFTER_HOURS,
                hoursSinceLastSuccess: hoursSince(status.lastSuccess?.finishedAt),
                overdueRows: overdue,
            },
        });
    } catch (error) {
        captureException(error, { requestId, context: 'GET /api/admin/retention' });
        return NextResponse.json(
            { success: false, error: 'Failed to load retention status' },
            { status: 500 },
        );
    }
}
