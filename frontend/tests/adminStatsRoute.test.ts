import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';

/* ── Hoisted mocks ───────────────────────────────────────────────────────────── */

const {
    mockRequireAdminRequest,
    mockGetServiceRoleClient,
} = vi.hoisted(() => ({
    mockRequireAdminRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAdminRequest: mockRequireAdminRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock('../src/lib/debug', () => ({
    structuredLog: vi.fn(),
    captureException: vi.fn(),
}));

import { GET } from '../src/app/api/admin/stats/route';

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

let ipCounter = 0;
function nextIp(): string {
    ipCounter += 1;
    return `203.0.113.${ipCounter % 250}`;
}

function statsRequest(ip?: string): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/stats', {
        method: 'GET',
        headers: { 'x-forwarded-for': ip ?? nextIp() },
    });
}

/**
 * Returns a mock Supabase client whose `.from().select()` chain returns
 * predictable counts and data sets for the admin stats queries.
 */
function happySupabaseClient() {
    return {
        from: vi.fn((table: string) => {
            if (table === 'institutions') {
                return {
                    select: vi.fn(() => ({
                        // For exact-count head query
                        not: vi.fn(() => ({
                            // institutions with wallet addresses
                            data: [{ id: 'inst-1' }] as unknown[],
                            error: null,
                            count: 3,
                        })),
                        count: 3,
                        error: null,
                        data: null,
                    })),
                };
            }
            if (table === 'credentials') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            count: 5,
                            error: null,
                            data: null,
                        })),
                        count: 10,
                        error: null,
                        data: [{ institution_id: 'inst-1' }],
                    })),
                };
            }
            if (table === 'students') {
                return {
                    select: vi.fn(() => ({
                        count: 7,
                        error: null,
                        data: null,
                    })),
                };
            }
            if (table === 'verification_logs') {
                return {
                    select: vi.fn(() => ({
                        gte: vi.fn(() => ({
                            count: 2,
                            error: null,
                            data: null,
                        })),
                        eq: vi.fn(() => ({
                            count: 1,
                            error: null,
                            data: null,
                        })),
                        count: 4,
                        error: null,
                        data: null,
                    })),
                };
            }
            if (table === 'indexer_state') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            maybeSingle: vi.fn(() => ({
                                data: { last_ledger: 0, updated_at: null },
                                error: null,
                            })),
                        })),
                    })),
                };
            }
            if (table === 'cron_run_log') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            order: vi.fn(() => ({
                                limit: vi.fn(() => ({
                                    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                                })),
                            })),
                        })),
                    })),
                };
            }
            return {
                select: vi.fn(() => ({
                    count: 0,
                    error: null,
                    data: null,
                })),
            };
        }),
    };
}

/* ── Tests ───────────────────────────────────────────────────────────────────── */

describe('GET /api/admin/stats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetRateLimitStore();
        mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-1' });
        mockGetServiceRoleClient.mockReturnValue(happySupabaseClient());
    });

    /* ─── Success branch ──────────────────────────────────────────────────── */

    it('returns 200 with stats for an authorised admin', async () => {
        const response = await GET(statsRequest());

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.success).toBe(true);
        expect(payload.stats).toBeDefined();
        expect(typeof payload.stats.totalInstitutions).toBe('number');
        expect(typeof payload.stats.totalCredentials).toBe('number');
        expect(typeof payload.stats.totalStudents).toBe('number');
        expect(payload.stats.verificationActivity).toBeDefined();
    });

    /* ─── Authz-failure branch ────────────────────────────────────────────── */

    it('returns 401 for unauthenticated requests', async () => {
        mockRequireAdminRequest.mockResolvedValue({
            ok: false,
            status: 401,
            error: 'Missing access token',
        });

        const response = await GET(statsRequest());

        expect(response.status).toBe(401);
        const payload = await response.json();
        expect(payload).toEqual({
            success: false,
            error: 'Missing access token',
        });
    });

    it('returns 403 for non-admin authenticated users', async () => {
        mockRequireAdminRequest.mockResolvedValue({
            ok: false,
            status: 403,
            error: 'Admin access required',
        });

        const response = await GET(statsRequest());

        expect(response.status).toBe(403);
        const payload = await response.json();
        expect(payload).toEqual({
            success: false,
            error: 'Admin access required',
        });
    });

    /* ─── Error branch ────────────────────────────────────────────────────── */

    it('returns 500 when getServiceRoleClient throws', async () => {
        mockGetServiceRoleClient.mockImplementation(() => {
            throw new Error('service role key missing');
        });

        const response = await GET(statsRequest());

        expect(response.status).toBe(500);
        const payload = await response.json();
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('Failed to fetch statistics');
    });
});
