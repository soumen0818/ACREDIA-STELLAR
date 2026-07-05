import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';


vi.mock('../src/lib/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

import { supabase } from '../src/lib/supabase';
import {
    getInstitutionCredentialsPaginated,
    getStudentCredentialsPaginated,
} from '../src/lib/credentialService';

const INST_ID    = 'inst-abc-123';
const STUDENT_ID = 'student-xyz-456';

type MockChain = {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
};

function mockChain(returnValue: object): MockChain {
    const resolved = vi.fn().mockResolvedValue(returnValue);
    const chain: MockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: resolved,
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        or: resolved,
    };
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    return chain;
}

// ─── Institution pagination tests ────────────────────────────────────────────

describe('getInstitutionCredentialsPaginated', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns correct page, total, and totalPages', async () => {
        mockChain({ data: [{ id: '1' }, { id: '2' }], count: 42, error: null });

        const result = await getInstitutionCredentialsPaginated(
            INST_ID, { page: 2, pageSize: 20 }
        );

        expect(result.page).toBe(2);
        expect(result.total).toBe(42);
        expect(result.totalPages).toBe(3);
        expect(result.data).toHaveLength(2);
    });

    it('passes correct offset and limit to range()', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getInstitutionCredentialsPaginated(INST_ID, { page: 3, pageSize: 10 });

        expect(chain.range).toHaveBeenCalledWith(20, 29);
    });

    it('filters by status active (revoked = false)', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getInstitutionCredentialsPaginated(
            INST_ID, { page: 1, pageSize: 20 }, { status: 'active' }
        );

        expect(chain.eq).toHaveBeenCalledWith('revoked', false);
    });

    it('filters by status revoked (revoked = true)', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getInstitutionCredentialsPaginated(
            INST_ID, { page: 1, pageSize: 20 }, { status: 'revoked' }
        );

        expect(chain.eq).toHaveBeenCalledWith('revoked', true);
    });

    it('applies dateFrom and dateTo filters', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getInstitutionCredentialsPaginated(
            INST_ID, { page: 1, pageSize: 20 },
            { dateFrom: '2025-01-01', dateTo: '2025-12-31' }
        );

        expect(chain.gte).toHaveBeenCalledWith('issued_at', '2025-01-01');
        expect(chain.lte).toHaveBeenCalledWith('issued_at', '2025-12-31T23:59:59Z');
    });

    it('returns empty array when data is null', async () => {
        mockChain({ data: null, count: 0, error: null });

        const result = await getInstitutionCredentialsPaginated(
            INST_ID, { page: 1, pageSize: 20 }
        );

        expect(result.data).toEqual([]);
        expect(result.totalPages).toBe(0);
    });

    it('throws when supabase returns an error', async () => {
        mockChain({ data: null, count: null, error: { message: 'DB error' } });

        await expect(
            getInstitutionCredentialsPaginated(INST_ID, { page: 1, pageSize: 20 })
        ).rejects.toMatchObject({ message: 'DB error' });
    });
});

// ─── Student pagination tests ─────────────────────────────────────────────────

describe('getStudentCredentialsPaginated', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns correct page, total, and totalPages', async () => {
        mockChain({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], count: 55, error: null });

        const result = await getStudentCredentialsPaginated(
            STUDENT_ID, { page: 1, pageSize: 20 }
        );

        expect(result.total).toBe(55);
        expect(result.totalPages).toBe(3);
        expect(result.data).toHaveLength(3);
    });

    it('passes correct offset for page 2', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getStudentCredentialsPaginated(STUDENT_ID, { page: 2, pageSize: 20 });

        expect(chain.range).toHaveBeenCalledWith(20, 39);
    });

    it('filters by status active', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getStudentCredentialsPaginated(
            STUDENT_ID, { page: 1, pageSize: 20 }, { status: 'active' }
        );

        expect(chain.eq).toHaveBeenCalledWith('revoked', false);
    });

    it('does not apply status filter when status is all', async () => {
        const chain = mockChain({ data: [], count: 0, error: null });

        await getStudentCredentialsPaginated(
            STUDENT_ID, { page: 1, pageSize: 20 }, { status: 'all' }
        );

        const eqCalls = chain.eq.mock.calls;
        const revokedCall = eqCalls.find((c: unknown[]) => c[0] === 'revoked');
        expect(revokedCall).toBeUndefined();
    });

    it('throws when supabase returns an error', async () => {
        mockChain({ data: null, count: null, error: { message: 'Connection failed' } });

        await expect(
            getStudentCredentialsPaginated(STUDENT_ID, { page: 1, pageSize: 20 })
        ).rejects.toMatchObject({ message: 'Connection failed' });
    });
});

// ─── Permission boundary tests ────────────────────────────────────────────────

const {
    mockRequireAuthenticatedRequest,
    mockGetServiceRoleClient,
    mockHasServiceRoleEnv,
} = vi.hoisted(() => ({
    mockRequireAuthenticatedRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockHasServiceRoleEnv: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAuthenticatedRequest: mockRequireAuthenticatedRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
    hasServiceRoleEnv: mockHasServiceRoleEnv,
    createUserScopedServerClient: vi.fn(),
}));

import { GET } from '../src/app/api/student/credentials/route';

function makeRequest(userId: string, params: Record<string, string> = {}): NextRequest {
    const url = new URL('http://localhost:3000/api/student/credentials');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new NextRequest(url.toString(), {
        headers: { Authorization: 'Bearer test-token' },
    });
}

describe('student credentials API — permission boundaries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHasServiceRoleEnv.mockReturnValue(true);
    });

    it('returns 401 when request is not authenticated', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: false,
            error: 'Invalid or expired access token',
            status: 401,
        });

        const response = await GET(makeRequest(''));
        const payload  = await response.json();

        expect(response.status).toBe(401);
        expect(payload.success).toBe(false);
    });

    it('only returns credentials belonging to the authenticated student', async () => {
        const STUDENT_ROW = { id: 'student-111', wallet_address: null };
        const CREDENTIALS = [{ id: 'cred-1', student_id: 'student-111' }];

        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'auth-user-abc',
        });

        const mockRange = vi.fn().mockResolvedValue({
            data: CREDENTIALS,
            count: 1,
            error: null,
        });

        const mockStudentChain = {
            select: vi.fn().mockReturnThis(),
            eq:     vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: STUDENT_ROW, error: null }),
        };

        const mockCredChain = {
            select: vi.fn().mockReturnThis(),
            eq:     vi.fn().mockReturnThis(),
            order:  vi.fn().mockReturnThis(),
            range:  mockRange,
        };

        mockGetServiceRoleClient.mockReturnValue({
            from: vi.fn((table: string) =>
                table === 'students' ? mockStudentChain : mockCredChain
            ),
        });

        const response = await GET(makeRequest('auth-user-abc'));
        const payload  = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);

        // Credentials query must be scoped to the resolved student id,
        // not any id supplied by the caller
        const eqCalls = mockCredChain.eq.mock.calls;
        const studentIdCall = eqCalls.find((c: unknown[]) => c[0] === 'student_id');
        expect(studentIdCall).toBeDefined();
        if (studentIdCall) {
            expect(studentIdCall[1]).toBe('student-111');
        }
    });

    it('returns empty result for authenticated user with no student row', async () => {
        mockRequireAuthenticatedRequest.mockResolvedValue({
            ok: true,
            userId: 'auth-user-xyz',
        });

        mockGetServiceRoleClient.mockReturnValue({
            from: vi.fn(() => ({
                select: vi.fn().mockReturnThis(),
                eq:     vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null } }) } },
            })),
            auth: {
                admin: {
                    getUserById: vi.fn().mockResolvedValue({ data: { user: null } }),
                },
            },
        });

        const response = await GET(makeRequest('auth-user-xyz'));
        const payload  = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.credentials).toEqual([]);
        expect(payload.total).toBe(0);
    });
});