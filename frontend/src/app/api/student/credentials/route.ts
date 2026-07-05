import { NextRequest, NextResponse } from 'next/server';
import {
    createUserScopedServerClient,
    getServiceRoleClient,
    hasServiceRoleEnv,
    requireAuthenticatedRequest,
} from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const STUDENT_CREDENTIALS_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'student-credentials',
} as const;

type CredentialRow = {
    id: string;
    token_id: string;
    ipfs_hash: string;
    blockchain_hash: string;
    metadata: unknown;
    issued_at: string;
    revoked: boolean;
    institution?: { name?: string }[] | { name?: string } | null;
};

export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';
    try {
        const rateLimitResponse = enforceRateLimit(request, STUDENT_CREDENTIALS_RATE_LIMIT);
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

        const authHeader = request.headers.get('authorization') || '';
        const accessToken = authHeader.toLowerCase().startsWith('bearer ')
            ? authHeader.slice(7)
            : '';

        const supabase = hasServiceRoleEnv()
            ? getServiceRoleClient()
            : createUserScopedServerClient(accessToken);

        // ── Pagination & filter params ────────────────────────────────────────
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

        // ── Resolve student row ───────────────────────────────────────────────
        const { data: initialStudentRow, error: studentError } = await supabase
            .from('students')
            .select('id, wallet_address')
            .eq('auth_user_id', authCheck.userId)
            .maybeSingle();

        const studentRow = initialStudentRow;

        if (studentError) {
            structuredLog('ERROR', 'Error fetching student row', requestId, { error: studentError });
            return NextResponse.json(
                { success: false, error: 'Failed to load student profile' },
                { status: 500 },
            );
        }

        if (!studentRow?.id) {
            return NextResponse.json({ success: true, credentials: [], total: 0, page, pageSize, totalPages: 0 });
        }

        // ── Build paginated query ─────────────────────────────────────────────
        let query = supabase
            .from('credentials')
            .select(
                `id, token_id, ipfs_hash, blockchain_hash, metadata, issued_at, revoked,
                 institution:institutions(name)`,
                { count: 'exact' }
            )
            .eq('student_id', studentRow.id)
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
                `metadata->credentialData->>institutionName.ilike.%${term}%,` +
                `metadata->credentialData->>credentialType.ilike.%${term}%,` +
                `metadata->credentialData->>degree.ilike.%${term}%`
            );
        }

        const { data, error, count } = await query;
        if (error) throw error;

        const credentials = (data || []).map((c: CredentialRow) => ({
            ...c,
            institution: Array.isArray(c.institution)
                ? c.institution[0] || null
                : c.institution || null,
        }));

        return NextResponse.json({
            success: true,
            credentials,
            total: count ?? 0,
            page,
            pageSize,
            totalPages: Math.ceil((count ?? 0) / pageSize),
        });

    } catch (err) {
        captureException(err, { requestId, context: 'GET /api/student/credentials' });
        return NextResponse.json(
            { success: false, error: 'Failed to fetch student credentials' },
            { status: 500 },
        );
    }
}