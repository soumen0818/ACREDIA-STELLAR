import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockGetServiceRoleClient,
    mockRequireAdminRequest,
    mockVerifyAdminAuthorizationTransaction,
    mockSingle,
    mockUpdate,
    mockEqAfterUpdate,
} = vi.hoisted(() => ({
    mockGetServiceRoleClient: vi.fn(),
    mockRequireAdminRequest: vi.fn(),
    mockVerifyAdminAuthorizationTransaction: vi.fn(),
    mockSingle: vi.fn(),
    mockUpdate: vi.fn(),
    mockEqAfterUpdate: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    getServiceRoleClient: mockGetServiceRoleClient,
    requireAdminRequest: mockRequireAdminRequest,
}));

vi.mock('../src/lib/adminAuthorizationVerification', () => ({
    verifyAdminAuthorizationTransaction: mockVerifyAdminAuthorizationTransaction,
}));

import { POST } from '../src/app/api/admin/update-authorization/route';

function request(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/update-authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('admin update authorization route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-1' });
        mockEqAfterUpdate.mockResolvedValue({ error: null });
        mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });
        mockSingle.mockResolvedValue({
            data: { id: 'institution-1', wallet_address: 'GWALLET' },
            error: null,
        });
        mockGetServiceRoleClient.mockReturnValue({
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: mockSingle,
                    })),
                })),
                update: mockUpdate,
            })),
        });
    });

    it('marks an institution verified only after transaction verification succeeds', async () => {
        mockVerifyAdminAuthorizationTransaction.mockResolvedValue({
            ok: true,
            walletAddress: 'GVERIFIEDWALLET',
            transactionHash: 'a'.repeat(64),
            contractId: 'CCONTRACT',
        });

        const response = await POST(
            request({
                walletAddress: 'GVERIFIEDWALLET',
                transactionHash: 'A'.repeat(64),
            }),
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith({
            verified: true,
            authorization_tx_hash: 'a'.repeat(64),
        });
        expect(mockEqAfterUpdate).toHaveBeenCalledWith('id', 'institution-1');
    });

    it('returns verifier failure states without updating the database', async () => {
        mockVerifyAdminAuthorizationTransaction.mockResolvedValue({
            ok: false,
            code: 'wrong-wallet',
            message: 'Authorization transaction succeeded, but it authorized a different wallet.',
            status: 422,
        });

        const response = await POST(
            request({
                walletAddress: 'GVERIFIEDWALLET',
                transactionHash: 'a'.repeat(64),
            }),
        );
        const payload = await response.json();

        expect(response.status).toBe(422);
        expect(payload).toEqual({
            success: false,
            error: 'Authorization transaction succeeded, but it authorized a different wallet.',
            code: 'wrong-wallet',
        });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('requires a transaction hash before verification can run', async () => {
        const response = await POST(request({ walletAddress: 'GVERIFIEDWALLET' }));
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload).toEqual({
            success: false,
            error: 'Authorization transaction hash is required',
        });
        expect(mockVerifyAdminAuthorizationTransaction).not.toHaveBeenCalled();
    });
});
