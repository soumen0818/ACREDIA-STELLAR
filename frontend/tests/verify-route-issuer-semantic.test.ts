import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/verify/[token]/route';
import { resetRateLimitStore } from '@/lib/rateLimit';

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data:
                            table === 'institutions'
                                ? { name: 'ACREDIA' }
                                : { id: 'cred-001', revoked_at: null, revocation_source: null },
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
    isAuthorizedIssuerOnChain: async () => false,
}));

describe('verify route issuer semantics', () => {
    beforeEach(() => {
        resetRateLimitStore();
    });

    it('exposes issuer authorization state without voiding the credential', async () => {
        const response = await GET(new Request('http://localhost/api/verify/123') as never, {
            params: Promise.resolve({ token: '123' }),
        });

        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.issuerAuthorized).toBe(false);
        expect(payload.verification.issuerStatus).toBe('revoked');
        // A credential validly issued before the issuer lost authorization
        // stays valid; only revocation or expiry end it.
        expect(payload.verification.verified).toBe(true);
        expect(payload.credential.status).toBe('valid');
    });
});
