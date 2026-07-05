import { NextRequest, NextResponse } from 'next/server';
import {
    getServiceRoleClient,
    hasServiceRoleEnv,
    requireAuthenticatedRequest,
} from '@/lib/serverAuth';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status }
            );
        }

        const supabase = hasServiceRoleEnv()
            ? getServiceRoleClient()
            : (() => { throw new Error('Service role key required'); })();

        // ── Resolve institution row ────────────────────────────────────────────
        const { data: institutionRow, error: instError } = await supabase
            .from('institutions')
            .select('id')
            .eq('auth_user_id', authCheck.userId)
            .maybeSingle();

        if (instError) {
            structuredLog('ERROR', 'Error fetching institution row', requestId, { error: instError });
            return NextResponse.json(
                { success: false, error: 'Failed to load institution profile' },
                { status: 500 }
            );
        }

        if (!institutionRow?.id) {
            return NextResponse.json(
                { success: false, error: 'Institution not found' },
                { status: 404 }
            );
        }

        // ── Pagination & filter params ─────────────────────────────────────────
        const { searchParams } = new URL(request.url);
        const rawPage     = parseInt(searchParams.get('page')     ?? '1');
        const rawPageSize = parseInt(searchParams.get('pageSize') ?? '20');
        const page     = Math.max(1, isNaN(rawPage)     ? 1  : rawPage);
        const pageSize = Math.min(100, Math.max(1, isNaN(rawPageSize) ? 20 : rawPageSize));
        const search   = searchParams.get('search')   ?? '';
        const status   = searchParams.get('status')   ?? 'all';
        const dateFrom = searchParams.get('dateFrom') ?? '';
        const dateTo   = searchParams.get('dateTo')   ?? '';
        const offset   = (page - 1) * pageSize;

        // ── Build paginated query ──────────────────────────────────────────────
        let query = supabase
            .from('credentials')
            .select('*', { count: 'exact' })
            .eq('institution_id', institutionRow.id)
            .order('issued_at', { ascending: false })
            .range(offset, offset + pageSize - 1);

        if (status === 'active')  query = query.eq('revoked', false);
        if (status === 'revoked') query = query.eq('revoked', true);
        if (dateFrom) query = query.gte('issued_at', dateFrom);
        if (dateTo)   query = query.lte('issued_at', dateTo + 'T23:59:59Z');
        if (search.trim()) {
            const term = search.trim();
            query = query.or(
                `token_id.ilike.%${term}%,` +
                `metadata->credentialData->>studentName.ilike.%${term}%,` +
                `metadata->credentialData->>degree.ilike.%${term}%,` +
                `metadata->credentialData->>credentialType.ilike.%${term}%`
            );
        }

        const { data, error, count } = await query;
        if (error) throw error;

        return NextResponse.json({
            success: true,
            credentials: data ?? [],
            total: count ?? 0,
            page,
            pageSize,
            totalPages: Math.ceil((count ?? 0) / pageSize),
        });

    } catch (err) {
        captureException(err, { requestId, context: 'GET /api/institution/credentials' });
        return NextResponse.json(
            { success: false, error: 'Failed to fetch institution credentials' },
            { status: 500 }
        );
    }
}