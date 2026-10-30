/**
 * Tests for Issue #171 — Public Issuer Trust Registry
 * Covers the GET /api/issuers route handler.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Vitest before imports)
// ---------------------------------------------------------------------------
vi.mock('@/lib/runtimeConfig', () => ({
    runtimeConfig: {
        supabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
        isProduction: false,
        stellar: {},
        contracts: {},
        debug: { enableLogs: false },
    },
    serverRuntimeConfig: {
        admin: { emailAllowlist: [] },
        auth: { serviceRoleKey: '' },
        verification: { hashSecret: '' },
        debug: { enableLogs: false },
    },
}));

vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: vi.fn().mockReturnValue(null), // no rate-limit block
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/issuers — route handler', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { GET } = await import('@/app/api/issuers/route');

    const mockVerifiedIssuers = [
        {
            id: 'inst-1',
            name: 'State University',
            wallet_address: 'GABCDE',
            authorization_tx_hash: 'txhash1',
            created_at: '2025-01-15T10:00:00Z',
        },
        {
            id: 'inst-2',
            name: 'Tech College',
            wallet_address: null,
            authorization_tx_hash: null,
            created_at: '2025-03-20T08:00:00Z',
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 200 with issuer list when Supabase succeeds', async () => {
        vi.mocked(createClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: mockVerifiedIssuers, error: null }),
            }),
        } as never);

        const req = new Request('http://localhost/api/issuers');
        // @ts-expect-error NextRequest vs Request
        const res = await GET(req);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.issuers).toHaveLength(2);
        expect(body.issuers[0].name).toBe('State University');
        expect(body.issuers[0].verified_at).toBe('2025-01-15T10:00:00Z');
    });

    it('maps created_at to verified_at and omits email', async () => {
        vi.mocked(createClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: [mockVerifiedIssuers[0]], error: null }),
            }),
        } as never);

        const req = new Request('http://localhost/api/issuers');
        // @ts-expect-error NextRequest vs Request
        const res = await GET(req);
        const body = await res.json();

        const issuer = body.issuers[0];
        expect(issuer).toHaveProperty('verified_at');
        expect(issuer).not.toHaveProperty('email');          // PII must not be exposed
        expect(issuer).not.toHaveProperty('created_at');     // remapped to verified_at
    });

    it('returns 503 when Supabase config is missing', async () => {
        // Temporarily override to simulate missing config
        const { runtimeConfig } = await import('@/lib/runtimeConfig');
        const original = { ...runtimeConfig.supabase };
        runtimeConfig.supabase.url = '';

        const req = new Request('http://localhost/api/issuers');
        // @ts-expect-error NextRequest vs Request
        const res = await GET(req);
        expect(res.status).toBe(503);

        runtimeConfig.supabase.url = original.url;
    });

    it('returns 500 when Supabase query errors', async () => {
        vi.mocked(createClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
        } as never);

        const req = new Request('http://localhost/api/issuers');
        // @ts-expect-error NextRequest vs Request
        const res = await GET(req);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    it('sets Cache-Control header on successful response', async () => {
        vi.mocked(createClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: mockVerifiedIssuers, error: null }),
            }),
        } as never);

        const req = new Request('http://localhost/api/issuers');
        // @ts-expect-error NextRequest vs Request
        const res = await GET(req);
        expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    });
});
