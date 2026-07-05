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
                            id: 'cred-001',
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
        issuer: 'GIssuer',
        student: 'GStudent',
        hash: 'derived-hash',
        uri: 'ipfs://cid-123',
    }),
    isRevoked: async () => false,
    isAuthorizedIssuer: async () => false,
}));

vi.mock('@/lib/credentialHash', () => ({
    deriveCredentialHash: async () => 'derived-hash',
}));

describe('verify route issuer semantics', () => {
    beforeEach(() => {
        resetRateLimitStore();
    });

    it('exposes issuer authorization state in the verification payload', async () => {
        const response = await GET(new Request('http://localhost/api/verify/token-123') as never, {
            params: Promise.resolve({ token: 'token-123' }),
        });

        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.issuerAuthorized).toBe(false);
        expect(payload.verification.issuerStatus).toBe('revoked');
    });
});
