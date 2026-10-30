import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/verify/[token]/route';
import { resetRateLimitStore } from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import {
    ContractConfigurationError,
    BlockchainUnavailableError,
} from '@/lib/contractReads';

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

const {
    mockGetCredentialFromChain,
    mockIsRevokedFromChain,
    mockIsAuthorizedIssuerOnChain,
} = vi.hoisted(() => ({
    mockGetCredentialFromChain: vi.fn(),
    mockIsRevokedFromChain: vi.fn(),
    mockIsAuthorizedIssuerOnChain: vi.fn(),
}));

vi.mock('@/lib/contractReads', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/contractReads')>();
    return {
        ...actual,
        getCredentialFromChain: mockGetCredentialFromChain,
        isRevokedFromChain: mockIsRevokedFromChain,
        isAuthorizedIssuerOnChain: mockIsAuthorizedIssuerOnChain,
    };
});

function verify(token = '123') {
    return GET(new NextRequest(`http://localhost/api/verify/${token}`), {
        params: Promise.resolve({ token }),
    });
}

describe('verify route error handling and payload checks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetRateLimitStore();
        mockIsRevokedFromChain.mockResolvedValue(false);
        mockIsAuthorizedIssuerOnChain.mockResolvedValue(true);
    });

    it('returns 404 if the token does not exist on the contract', async () => {
        mockGetCredentialFromChain.mockResolvedValue(null);

        const response = await verify('999');

        expect(response.status).toBe(404);
        const payload = await response.json();
        expect(payload).toEqual({
            success: false,
            error: 'Credential not found',
        });
    });

    it('returns 500 when ContractConfigurationError is thrown', async () => {
        mockGetCredentialFromChain.mockRejectedValue(
            new ContractConfigurationError('Missing contract configuration'),
        );

        const response = await verify();

        expect(response.status).toBe(500);
        const payload = await response.json();
        expect(payload).toEqual({
            success: false,
            error: 'Server configuration error',
        });
    });

    it('returns 503 when BlockchainUnavailableError is thrown', async () => {
        mockGetCredentialFromChain.mockRejectedValue(
            new BlockchainUnavailableError('Blockchain verification unavailable'),
        );

        const response = await verify();

        expect(response.status).toBe(503);
        const payload = await response.json();
        expect(payload).toEqual({
            success: false,
            error: 'Blockchain verification unavailable',
        });
    });

    it('returns 500 without details for an unexpected error', async () => {
        mockGetCredentialFromChain.mockRejectedValue(new Error('boom: secret detail'));

        const response = await verify();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: 'Internal server error',
        });
    });

    it('verifies a credential without the retired database or IPFS checks in the payload', async () => {
        mockGetCredentialFromChain.mockResolvedValue({
            tokenId: '123',
            student: 'GStudent',
            issuer: 'GIssuer',
            hash: 'derived-hash',
            issuedAt: 1_770_000_000,
            expiresAt: null,
            revoked: false,
        });

        const response = await verify();

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(true);
        expect(payload.verification.onChainFound).toBe(true);
        expect(payload.verification.issuerAuthorized).toBe(true);
        expect(payload.verification.databaseMatch).toBeUndefined();
        expect(payload.verification.onChainMatch).toBeUndefined();
        expect(payload.verification.integrity).toBeUndefined();
    });
});
