/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/verify/[token]/route';
import { resetRateLimitStore } from '@/lib/rateLimit';

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: {
                            token_id: 'token-123',
                            issued_at: '2026-01-01T00:00:00.000Z',
                            revoked: false,
                            revoked_at: null,
                            metadata: {
                                credentialData: {
                                    institutionName: 'ACREDIA',
                                    credentialType: 'Degree',
                                },
                            },
                            metadata_schema_version: 1,
                            hash_algorithm: 'sha256',
                            ipfs_hash: 'cid-123',
                            student_wallet_address: 'GStudent',
                            issuer_wallet_address: 'GIssuer',
                            institution: { name: 'ACREDIA' },
                        },
                        error: null,
                    }),
                }),
            }),
        }),
    }),
}));

vi.mock('@/lib/contractReads', () => ({
    getCredential: async () => ({
        issuer: 'gissuer',
        student: 'gstudent',
        hash: 'derived-hash',
        uri: 'ipfs://cid-123',
    }),
    isRevoked: async () => false,
    isAuthorizedIssuer: async () => true,
}));

vi.mock('@/lib/credentialHash', () => ({
    deriveCredentialHash: async () => 'derived-hash',
}));

describe('verify route rate limiting', () => {
    beforeEach(() => {
        resetRateLimitStore();
    });

    it('returns 429 with Retry-After after the verify limit is exceeded', async () => {
        const makeRequest = () =>
            new Request('http://localhost/api/verify/token-123', {
                headers: {
                    'x-forwarded-for': '203.0.113.10',
                },
            });

        for (let index = 0; index < 10; index += 1) {
            const response = await GET(makeRequest() as any, {
                params: Promise.resolve({ token: 'token-123' }),
            });

            expect(response.status).toBe(200);
        }
        const blockedResponse = await GET(makeRequest() as any, {
            params: Promise.resolve({ token: 'token-123' }),
        });

        expect(blockedResponse.status).toBe(429);
        expect(blockedResponse.headers.get('Retry-After')).toBeTruthy();
        await expect(blockedResponse.json()).resolves.toEqual({
            success: false,
            error: 'Too many requests',
        });
    });
});
