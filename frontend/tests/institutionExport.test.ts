import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockRequireAuthenticatedRequest,
    mockHasServiceRoleEnv,
    mockGetServiceRoleClient,
    mockInstMaybeSingle,
    mockCredOrder,
} = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockHasServiceRoleEnv: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockInstMaybeSingle: vi.fn(),
    mockCredOrder: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    hasServiceRoleEnv: mockHasServiceRoleEnv,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

import { GET } from '../src/app/api/institution/export/route';

function makeRequest(): NextRequest {
    return new NextRequest('http://localhost/api/institution/export', {
        headers: { Authorization: 'Bearer test-token' },
    });
}

function makeSupabase() {
    return {
        from: vi.fn((table: string) => {
            // Institution resolution goes through the membership table since
            // Issue #238; `mockInstMaybeSingle` still supplies the row.
            if (table === 'institution_users' || table === 'institutions') {
                const builder: Record<string, unknown> = {};
                for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
                    builder[method] = () => builder;
                }
                // No membership row: the user resolves through the legacy
                // `institutions.auth_user_id` column, which `mockInstMaybeSingle`
                // supplies. (A membership row in any status disables that
                // fallback — Issue #307.)
                builder.maybeSingle =
                    table === 'institution_users'
                        ? async () => ({ data: null, error: null })
                        : mockInstMaybeSingle;
                return builder;
            }
            if (table === 'credentials') {
                return {
                    select: () => ({
                        eq: () => ({ order: mockCredOrder }),
                    }),
                };
            }
            return {};
        }),
    };
}

describe('GET /api/institution/export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: true, userId: 'user-1' });
        mockHasServiceRoleEnv.mockReturnValue(true);
        mockInstMaybeSingle.mockResolvedValue({ data: { id: 'inst-1' }, error: null });
        mockCredOrder.mockResolvedValue({ data: [], error: null });
        mockGetServiceRoleClient.mockReturnValue(makeSupabase());
    });

    it('returns 401 when auth check fails', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 });
        const res = await GET(makeRequest());
        expect(res.status).toBe(401);
    });

    it('returns 404 when institution is not found', async () => {
        mockInstMaybeSingle.mockResolvedValue({ data: null, error: null });
        const res = await GET(makeRequest());
        expect(res.status).toBe(404);
    });

    it('returns 200 with text/csv content-type', async () => {
        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/csv');
    });

    it('sets content-disposition to attachment with filename', async () => {
        const res = await GET(makeRequest());
        expect(res.headers.get('content-disposition')).toContain('attachment');
        expect(res.headers.get('content-disposition')).toContain('credentials.csv');
    });

    it('CSV body starts with the header row', async () => {
        const res = await GET(makeRequest());
        const text = await res.text();
        expect(text.startsWith('token_id,student_name')).toBe(true);
    });

    it('includes credential data rows in the CSV', async () => {
        mockCredOrder.mockResolvedValue({
            data: [
                {
                    token_id: 'tok-99',
                    issued_at: '2025-05-01T00:00:00Z',
                    revoked: false,
                    metadata: { credentialData: { studentName: 'Carol', credentialType: 'Master' } },
                },
            ],
            error: null,
        });
        const res = await GET(makeRequest());
        const text = await res.text();
        expect(text).toContain('tok-99');
        expect(text).toContain('Carol');
        expect(text).toContain('active');
    });

    it('returns 500 when credential query throws', async () => {
        mockCredOrder.mockRejectedValue(new Error('db failure'));
        const res = await GET(makeRequest());
        expect(res.status).toBe(500);
    });
});
