/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/verify/[token]/route';
import { resetRateLimitStore } from '@/lib/rateLimit';

const state = vi.hoisted(() => ({ credentialRow: null as Record<string, unknown> | null }));

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: table === 'institutions' ? { name: 'ACREDIA' } : state.credentialRow,
                        error: null,
                    }),
                }),
            }),
            insert: async () => ({ error: null }),
        }),
    }),
}));

vi.mock('@/lib/contractReads', () => ({
    getCredentialFromChain: async () => ({
        tokenId: '123',
        student: 'GStudent',
        issuer: 'GIssuer',
        hash: 'derived-hash',
        issuedAt: 1_770_000_000,
        expiresAt: null,
        revoked: false,
    }),
    isRevokedFromChain: async () => false,
    isAuthorizedIssuerOnChain: async () => true,
}));

describe('verify route rate limiting', () => {
    beforeEach(() => {
        resetRateLimitStore();
    });

    it('returns 429 with Retry-After after the verify limit is exceeded', async () => {
        const makeRequest = () =>
            new Request('http://localhost/api/verify/123', {
                headers: {
                    'x-forwarded-for': '203.0.113.10',
                },
            });

        // Matches VERIFY_RATE_LIMIT.maxRequests for the anonymous (per-IP) path.
        // Raised from 10 to 60 so a university behind a single NAT egress
        // address is not throttled; keep this in step with the route.
        const ANONYMOUS_LIMIT = 60;

        for (let index = 0; index < ANONYMOUS_LIMIT; index += 1) {
            const response = await GET(makeRequest() as any, {
                params: Promise.resolve({ token: '123' }),
            });

            expect(response.status).toBe(200);
        }
        const blockedResponse = await GET(makeRequest() as any, {
            params: Promise.resolve({ token: '123' }),
        });

        expect(blockedResponse.status).toBe(429);
        expect(blockedResponse.headers.get('Retry-After')).toBeTruthy();
        await expect(blockedResponse.json()).resolves.toEqual({
            success: false,
            error: 'Too many requests',
        });
    });
});
