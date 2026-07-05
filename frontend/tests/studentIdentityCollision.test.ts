import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Hoist mock functions
const {
    mockRequireAuthenticatedRequest,
    mockGetServiceRoleClient,
} = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
    hasServiceRoleEnv: vi.fn().mockReturnValue(true),
    createUserScopedServerClient: vi.fn(),
}));

import { POST as provisionPOST } from '../src/app/api/student/provision/route';
import { GET as credentialsGET } from '../src/app/api/student/credentials/route';

function makeRequest(urlStr: string, method: string = 'POST'): NextRequest {
    return new NextRequest(urlStr, {
        method,
        headers: { Authorization: 'Bearer test-token' },
    });
}

describe('Student Identity & Provisioning Security Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 Unauthorized for unauthenticated provisioning requests', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: false,
            error: 'Unauthorized',
            status: 401,
        });

        const req = makeRequest('http://localhost/api/student/provision');
        const res = await provisionPOST(req);
        const payload = await res.json();

        expect(res.status).toBe(401);
        expect(payload.success).toBe(false);
    });

    it('returns 403 Forbidden when email is not confirmed', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'unverified-auth-id',
        });

        const mockGetUserById = vi.fn().mockResolvedValue({
            data: {
                user: {
                    id: 'unverified-auth-id',
                    email: 'unverified@example.com',
                    email_confirmed_at: null, // NOT verified
                    user_metadata: { name: 'Unverified' }
                }
            },
            error: null
        });

        mockGetServiceRoleClient.mockReturnValue({
            auth: {
                admin: {
                    getUserById: mockGetUserById
                }
            }
        });

        const req = makeRequest('http://localhost/api/student/provision');
        const res = await provisionPOST(req);
        const payload = await res.json();

        expect(res.status).toBe(403);
        expect(payload.success).toBe(false);
        expect(payload.error).toContain('Email verification is required');
    });

    it('returns 409 Conflict when the student record is already linked to another auth_user_id', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'attacker-auth-id',
        });

        const mockGetUserById = vi.fn().mockResolvedValue({
            data: {
                user: {
                    id: 'attacker-auth-id',
                    email: 'victim@example.com',
                    email_confirmed_at: '2026-06-29T12:00:00Z',
                    user_metadata: { name: 'Attacker' }
                }
            },
            error: null
        });

        // 1. Check if profile exists by auth_user_id: returns null (doesn't exist)
        const mockMaybeSingleByAuth = vi.fn().mockResolvedValue({ data: null, error: null });
        // 2. Check if profile exists by email: returns victim's profile linked to victim's auth_user_id
        const mockMaybeSingleByEmail = vi.fn().mockResolvedValue({
            data: {
                id: 'student-victim-id',
                email: 'victim@example.com',
                auth_user_id: 'victim-auth-id',
                wallet_address: 'GVictimWallet'
            },
            error: null
        });

        const mockFrom = vi.fn((table: string) => {
            if (table === 'students') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn((column: string) => ({
                            maybeSingle: column === 'auth_user_id' ? mockMaybeSingleByAuth : mockMaybeSingleByEmail
                        }))
                    }))
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        mockGetServiceRoleClient.mockReturnValue({
            auth: {
                admin: {
                    getUserById: mockGetUserById
                }
            },
            from: mockFrom
        });

        const req = makeRequest('http://localhost/api/student/provision');
        const res = await provisionPOST(req);
        const payload = await res.json();

        expect(res.status).toBe(409);
        expect(payload.success).toBe(false);
        expect(payload.error).toContain('already linked to another student account');
    });

    it('successfully links/adopts an unlinked student record if user email is verified', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'new-auth-id',
        });

        const mockGetUserById = vi.fn().mockResolvedValue({
            data: {
                user: {
                    id: 'new-auth-id',
                    email: 'student@example.com',
                    email_confirmed_at: '2026-06-29T12:00:00Z',
                    user_metadata: { name: 'Student Name' }
                }
            },
            error: null
        });

        const mockMaybeSingleByAuth = vi.fn().mockResolvedValue({ data: null, error: null });
        const mockMaybeSingleByEmail = vi.fn().mockResolvedValue({
            data: {
                id: 'pre-created-student-id',
                email: 'student@example.com',
                auth_user_id: null,
                wallet_address: null
            },
            error: null
        });

        const mockUpdate = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                            id: 'pre-created-student-id',
                            email: 'student@example.com',
                            auth_user_id: 'new-auth-id',
                            wallet_address: null
                        },
                        error: null
                    })
                })
            })
        });

        const mockFrom = vi.fn((table: string) => {
            if (table === 'students') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn((column: string) => ({
                            maybeSingle: column === 'auth_user_id' ? mockMaybeSingleByAuth : mockMaybeSingleByEmail
                        }))
                    })),
                    update: mockUpdate
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        mockGetServiceRoleClient.mockReturnValue({
            auth: {
                admin: {
                    getUserById: mockGetUserById
                }
            },
            from: mockFrom
        });

        const req = makeRequest('http://localhost/api/student/provision');
        const res = await provisionPOST(req);
        const payload = await res.json();

        expect(res.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.student.auth_user_id).toBe('new-auth-id');
        expect(mockUpdate).toHaveBeenCalledWith({ auth_user_id: 'new-auth-id' });
    });

    it('creates a new student record if student record does not exist by auth_user_id or email', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'brand-new-id',
        });

        const mockGetUserById = vi.fn().mockResolvedValue({
            data: {
                user: {
                    id: 'brand-new-id',
                    email: 'brandnew@example.com',
                    email_confirmed_at: '2026-06-29T12:00:00Z',
                    user_metadata: { name: 'Brand New' }
                }
            },
            error: null
        });

        const mockMaybeSingleByAuth = vi.fn().mockResolvedValue({ data: null, error: null });
        const mockMaybeSingleByEmail = vi.fn().mockResolvedValue({ data: null, error: null });

        const mockInsert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: 'new-student-uuid',
                        email: 'brandnew@example.com',
                        auth_user_id: 'brand-new-id',
                        wallet_address: null
                    },
                    error: null
                })
            })
        });

        const mockFrom = vi.fn((table: string) => {
            if (table === 'students') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn((column: string) => ({
                            maybeSingle: column === 'auth_user_id' ? mockMaybeSingleByAuth : mockMaybeSingleByEmail
                        }))
                    })),
                    insert: mockInsert
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        mockGetServiceRoleClient.mockReturnValue({
            auth: {
                admin: {
                    getUserById: mockGetUserById
                }
            },
            from: mockFrom
        });

        const req = makeRequest('http://localhost/api/student/provision');
        const res = await provisionPOST(req);
        const payload = await res.json();

        expect(res.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.student.auth_user_id).toBe('brand-new-id');
        expect(mockInsert).toHaveBeenCalledWith({
            auth_user_id: 'brand-new-id',
            name: 'Brand New',
            email: 'brandnew@example.com'
        });
    });

    it('returns empty credentials list when student profile is missing', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'no-student-id',
        });

        const mockFrom = vi.fn((table: string) => {
            if (table === 'students') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        mockGetServiceRoleClient.mockReturnValue({
            from: mockFrom
        });

        const req = makeRequest('http://localhost/api/student/credentials', 'GET');
        const res = await credentialsGET(req);
        const payload = await res.json();

        expect(res.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.credentials).toEqual([]);
        expect(payload.total).toBe(0);
    });
});
