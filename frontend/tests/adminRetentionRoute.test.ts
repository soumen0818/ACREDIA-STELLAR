import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';

/* ── Hoisted mocks ───────────────────────────────────────────────────────────── */

const { mockRequireAdminRequest, mockGetServiceRoleClient, mockStructuredLog } = vi.hoisted(() => ({
    mockRequireAdminRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockStructuredLog: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAdminRequest: mockRequireAdminRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock('../src/lib/debug', () => ({
    structuredLog: mockStructuredLog,
    captureException: vi.fn(),
}));

import { GET } from '../src/app/api/admin/retention/route';
import { STALE_AFTER_HOURS, hoursSince, isRetentionStale } from '../src/lib/retentionHealth';

let ipCounter = 0;
function retentionRequest(): NextRequest {
    ipCounter += 1;
    return new NextRequest('http://localhost:3000/api/admin/retention', {
        method: 'GET',
        headers: { 'x-forwarded-for': `198.51.100.${ipCounter % 250}` },
    });
}

function statusClient(status: unknown) {
    return { rpc: vi.fn(async () => ({ data: status, error: null })) };
}

function healthyStatus(overrides: Record<string, unknown> = {}) {
    return {
        verificationLogs: { total: 120, overdue: 0, oldest: null, retentionDays: 90 },
        contactMessages: { total: 4, overdue: 0, oldest: null, retentionMonths: 24 },
        lastSuccess: {
            finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
            rowsDeleted: 3,
            durationMs: 12,
            detail: { verification_logs: 3, contact_messages: 0 },
        },
        lastFailure: null,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-1' });
});

describe('retention staleness', () => {
    const now = Date.parse('2026-08-28T12:00:00Z');

    it('treats a never-run purge as stale', () => {
        // "No purge has ever run" is precisely the state issue #227 describes,
        // so it must never read as healthy.
        expect(isRetentionStale(null, now)).toBe(true);
        expect(isRetentionStale(undefined, now)).toBe(true);
        expect(isRetentionStale('not-a-date', now)).toBe(true);
    });

    it('tolerates a single missed night but not two', () => {
        const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

        expect(isRetentionStale(hoursAgo(25), now)).toBe(false);
        expect(isRetentionStale(hoursAgo(STALE_AFTER_HOURS - 1), now)).toBe(false);
        expect(isRetentionStale(hoursAgo(STALE_AFTER_HOURS + 1), now)).toBe(true);
    });

    it('measures age in hours', () => {
        expect(hoursSince(new Date(now - 7_200_000).toISOString(), now)).toBeCloseTo(2);
        expect(hoursSince(null, now)).toBeNull();
    });
});

describe('GET /api/admin/retention', () => {
    it('requires an admin caller', async () => {
        mockRequireAdminRequest.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });

        const response = await GET(retentionRequest());

        expect(response.status).toBe(403);
        expect(mockGetServiceRoleClient).not.toHaveBeenCalled();
    });

    it('reports a healthy deployment without raising an alert', async () => {
        mockGetServiceRoleClient.mockReturnValue(statusClient(healthyStatus()));

        const response = await GET(retentionRequest());
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.retention.stale).toBe(false);
        expect(body.retention.overdueRows).toBe(0);
        expect(body.retention.staleAfterHours).toBe(STALE_AFTER_HOURS);
        expect(mockStructuredLog).not.toHaveBeenCalledWith(
            'ERROR',
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
    });

    it('alerts when no purge has succeeded within the window', async () => {
        mockGetServiceRoleClient.mockReturnValue(
            statusClient(healthyStatus({ lastSuccess: null })),
        );

        const response = await GET(retentionRequest());
        const body = await response.json();

        expect(body.retention.stale).toBe(true);
        expect(mockStructuredLog).toHaveBeenCalledWith(
            'ERROR',
            'Data retention is not being enforced',
            expect.any(String),
            expect.objectContaining({ stale: true }),
        );
    });

    it('alerts when rows are past their published retention period', async () => {
        mockGetServiceRoleClient.mockReturnValue(
            statusClient(
                healthyStatus({
                    verificationLogs: {
                        total: 500,
                        overdue: 42,
                        oldest: '2020-01-01T00:00:00Z',
                        retentionDays: 90,
                    },
                }),
            ),
        );

        const response = await GET(retentionRequest());
        const body = await response.json();

        // Not stale — the job is running — but it is not achieving the policy,
        // which is just as much a compliance failure.
        expect(body.retention.stale).toBe(false);
        expect(body.retention.overdueRows).toBe(42);
        expect(mockStructuredLog).toHaveBeenCalledWith(
            'ERROR',
            'Data retention is not being enforced',
            expect.any(String),
            expect.objectContaining({ overdueRows: 42 }),
        );
    });

    it('returns 500 when the status function is unavailable', async () => {
        mockGetServiceRoleClient.mockReturnValue({
            rpc: vi.fn(async () => ({ data: null, error: { message: 'no such function' } })),
        });

        const response = await GET(retentionRequest());

        expect(response.status).toBe(500);
    });
});
