import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCreateUserScopedServerClient,
    mockGetServiceRoleClient,
    mockHasServiceRoleEnv,
    mockRequireAuthenticatedRequest,
    mockEqAfterFind,
    mockMaybeSingle,
    mockUpdate,
    mockFirstEqAfterUpdate,
    mockSecondEqAfterUpdate,
    mockSelectAfterUpdate,
    mockSingleAfterUpdate,
} = vi.hoisted(() => ({
    mockCreateUserScopedServerClient: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockHasServiceRoleEnv: vi.fn(),
    mockRequireAuthenticatedRequest: vi.fn(),
    mockEqAfterFind: vi.fn(),
    mockMaybeSingle: vi.fn(),
    mockUpdate: vi.fn(),
    mockFirstEqAfterUpdate: vi.fn(),
    mockSecondEqAfterUpdate: vi.fn(),
    mockSelectAfterUpdate: vi.fn(),
    mockSingleAfterUpdate: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    createUserScopedServerClient: mockCreateUserScopedServerClient,
    getServiceRoleClient: mockGetServiceRoleClient,
    hasServiceRoleEnv: mockHasServiceRoleEnv,
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
}));

import { POST } from '../src/app/api/institution/link-wallet/route';

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/institution/link-wallet', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

describe('institution link wallet route', () => {
    const walletAddress = Keypair.random().publicKey();

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireAuthenticatedRequest.mockResolvedValue({ ok: true, userId: 'institution-user' });
        mockHasServiceRoleEnv.mockReturnValue(true);
        mockEqAfterFind.mockReturnValue({ maybeSingle: mockMaybeSingle });
        mockMaybeSingle.mockResolvedValue({
            data: { id: 'institution-1', wallet_address: null },
            error: null,
        });
        mockUpdate.mockReturnValue({ eq: mockFirstEqAfterUpdate });
        mockFirstEqAfterUpdate.mockReturnValue({ eq: mockSecondEqAfterUpdate });
        mockSecondEqAfterUpdate.mockReturnValue({ select: mockSelectAfterUpdate });
        mockSelectAfterUpdate.mockReturnValue({ single: mockSingleAfterUpdate });
        mockSingleAfterUpdate.mockResolvedValue({
            data: { id: 'institution-1', wallet_address: walletAddress },
            error: null,
        });
        mockGetServiceRoleClient.mockReturnValue({
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: mockEqAfterFind,
                })),
                update: mockUpdate,
            })),
        });
    });

    it('links the authenticated institution wallet and clears stale authorization', async () => {
        const response = await POST(request({ walletAddress }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            success: true,
            walletAddress,
            changed: true,
        });
        expect(mockEqAfterFind).toHaveBeenCalledWith('auth_user_id', 'institution-user');
        expect(mockUpdate).toHaveBeenCalledWith({
            wallet_address: walletAddress,
            verified: false,
            authorization_tx_hash: null,
        });
        expect(mockFirstEqAfterUpdate).toHaveBeenCalledWith('id', 'institution-1');
        expect(mockSecondEqAfterUpdate).toHaveBeenCalledWith(
            'auth_user_id',
            'institution-user',
        );
    });

    it('does not reset authorization when the same wallet is already linked', async () => {
        mockMaybeSingle.mockResolvedValue({
            data: { id: 'institution-1', wallet_address: walletAddress },
            error: null,
        });

        const response = await POST(request({ walletAddress }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            success: true,
            walletAddress,
            changed: false,
        });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects invalid Stellar wallet addresses', async () => {
        const response = await POST(request({ walletAddress: 'not-a-stellar-key' }));
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toEqual({
            success: false,
            error: 'Wallet address must be a valid Stellar public key',
        });
        expect(mockGetServiceRoleClient).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('requires an institution profile for the authenticated user', async () => {
        mockMaybeSingle.mockResolvedValue({ data: null, error: null });

        const response = await POST(request({ walletAddress }));
        const payload = await response.json();

        expect(response.status).toBe(404);
        expect(payload).toEqual({
            success: false,
            error: 'Institution profile not found',
        });
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
