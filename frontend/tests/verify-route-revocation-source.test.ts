import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/verify/[token]/route';
import { resetRateLimitStore } from '@/lib/rateLimit';

const state = vi.hoisted(() => ({
    credential: null as Record<string, unknown> | null,
    onChainRevoked: false,
}));

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: table === 'institutions' ? { name: 'ACREDIA' } : state.credential,
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
        revoked: state.onChainRevoked,
    }),
    isRevokedFromChain: async () => state.onChainRevoked,
    isAuthorizedIssuerOnChain: async () => true,
}));

/** The database row only labels which on-chain event revoked the credential. */
function baseCredential(overrides: Record<string, unknown>) {
    return {
        id: 'cred-001',
        revoked_at: null,
        revocation_source: null,
        ...overrides,
    };
}

async function verify() {
    const response = await GET(new Request('http://localhost/api/verify/123') as never, {
        params: Promise.resolve({ token: '123' }),
    });
    return { response, payload: await response.json() };
}

describe('verify route revocation source', () => {
    beforeEach(() => {
        resetRateLimitStore();
        state.onChainRevoked = false;
    });

    it('reports an issuer revocation distinctly', async () => {
        state.onChainRevoked = true;
        state.credential = baseCredential({
            revoked: true,
            revoked_at: '2026-02-01T00:00:00.000Z',
            revocation_source: 'issuer',
        });

        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.credential.revoked).toBe(true);
        expect(payload.credential.revocationSource).toBe('issuer');
        expect(payload.verification.revocationSource).toBe('issuer');
    });

    it('reports a platform (owner override) revocation distinctly', async () => {
        state.onChainRevoked = true;
        state.credential = baseCredential({
            revoked: true,
            revoked_at: '2026-02-01T00:00:00.000Z',
            revocation_source: 'platform',
        });

        const { payload } = await verify();

        expect(payload.credential.revoked).toBe(true);
        expect(payload.credential.revocationSource).toBe('platform');
        expect(payload.verification.revocationSource).toBe('platform');
    });

    it('leaves revocation source null for a live credential', async () => {
        state.credential = baseCredential({ revoked: false });

        const { payload } = await verify();

        expect(payload.credential.revoked).toBe(false);
        expect(payload.credential.revocationSource).toBeNull();
        expect(payload.verification.revocationSource).toBeNull();
    });

    it('falls back to null when a revoked credential has no recorded source', async () => {
        state.onChainRevoked = true;
        state.credential = baseCredential({
            revoked: true,
            revoked_at: '2026-02-01T00:00:00.000Z',
            revocation_source: null,
        });

        const { payload } = await verify();

        expect(payload.credential.revoked).toBe(true);
        expect(payload.credential.revocationSource).toBeNull();
    });
});
