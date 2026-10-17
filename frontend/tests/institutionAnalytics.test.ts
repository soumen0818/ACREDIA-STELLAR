import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockRequireAuthenticatedRequest,
    mockHasServiceRoleEnv,
    mockGetServiceRoleClient,
    mockInstMaybeSingle,
    mockCredEq,
    mockLogsIn,
} = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockHasServiceRoleEnv: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockInstMaybeSingle: vi.fn(),
    mockCredEq: vi.fn(),
    mockLogsIn: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    hasServiceRoleEnv: mockHasServiceRoleEnv,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

import { GET } from '../src/app/api/institution/analytics/route';

function makeRequest(): NextRequest {
    return new NextRequest('http://localhost/api/institution/analytics', {
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
                    select: () => ({ eq: mockCredEq }),
                };
            }
            if (table === 'verification_logs') {
                return {
                    select: () => ({ in: mockLogsIn }),
                };
            }
            return {};
        }),
    };
}

describe('GET /api/institution/analytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: true, userId: 'user-1' });
        mockHasServiceRoleEnv.mockReturnValue(true);
        mockInstMaybeSingle.mockResolvedValue({ data: { id: 'inst-1' }, error: null });
        mockCredEq.mockResolvedValue({ data: [], error: null });
        mockLogsIn.mockResolvedValue({ data: [], error: null });
        mockGetServiceRoleClient.mockReturnValue(makeSupabase());
    });

    it('returns 401 when auth check fails', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 });
        const res = await GET(makeRequest());
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    it('returns 404 when institution is not found', async () => {
        mockInstMaybeSingle.mockResolvedValue({ data: null, error: null });
        const res = await GET(makeRequest());
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Institution not found');
    });

    it('returns 500 when institution query errors', async () => {
        mockInstMaybeSingle.mockResolvedValue({ data: null, error: new Error('db error') });
        const res = await GET(makeRequest());
        expect(res.status).toBe(500);
    });

    it('returns success with empty data when institution has no credentials', async () => {
        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.issuedOverTime).toHaveLength(12);
        expect(body.statusBreakdown).toEqual({ active: 0, revoked: 0, total: 0 });
        expect(body.verificationsOverTime).toHaveLength(12);
        expect(body.topVerifiedCredentials).toEqual([]);
    });

    it('returns correct status breakdown for mixed credentials', async () => {
        mockCredEq.mockResolvedValue({
            data: [
                { id: 'c1', token_id: 't1', issued_at: '2025-06-01T00:00:00Z', revoked: false, metadata: null },
                { id: 'c2', token_id: 't2', issued_at: '2025-07-01T00:00:00Z', revoked: true, metadata: null },
            ],
            error: null,
        });
        const res = await GET(makeRequest());
        const body = await res.json();
        expect(body.statusBreakdown).toEqual({ active: 1, revoked: 1, total: 2 });
    });

    it('aggregates verifications over time from verification_logs', async () => {
        mockCredEq.mockResolvedValue({
            data: [{ id: 'c1', token_id: 't1', issued_at: '2026-01-01T00:00:00Z', revoked: false, metadata: null }],
            error: null,
        });
        mockLogsIn.mockResolvedValue({
            data: [
                { credential_id: 'c1', created_at: '2026-03-10T00:00:00Z' },
                { credential_id: 'c1', created_at: '2026-03-20T00:00:00Z' },
            ],
            error: null,
        });
        const res = await GET(makeRequest());
        const body = await res.json();
        const mar = body.verificationsOverTime.find((r: { month: string; count: number }) => r.month === '2026-03');
        expect(mar?.count).toBe(2);
        expect(mockLogsIn).toHaveBeenCalledWith('credential_id', ['c1']);
    });

    it('returns 500 when credential query throws', async () => {
        mockCredEq.mockRejectedValue(new Error('network error'));
        const res = await GET(makeRequest());
        expect(res.status).toBe(500);
    });

    it('skips verification_logs query when institution has no credentials', async () => {
        mockCredEq.mockResolvedValue({ data: [], error: null });
        await GET(makeRequest());
        expect(mockLogsIn).not.toHaveBeenCalled();
    });
});
