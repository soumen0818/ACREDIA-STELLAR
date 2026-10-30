import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';

/**
 * GET /api/credentials/:id/document (review §3.11b): a signed URL for the
 * holder or the issuing institution, and a 404 for everyone else.
 */

const CREDENTIAL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const HOLDER = 'user-holder';
const MEMBER = 'user-member';
const OWNER = 'user-owner';
const STRANGER = 'user-stranger';

const state = vi.hoisted(() => ({
    credential: null as Record<string, unknown> | null,
    userId: 'user-holder',
    createSignedUrl: vi.fn(),
    bucket: vi.fn(),
    requireAuth: vi.fn(),
}));

/** A tiny PostgREST stand-in: each table answers from its filters. */
function rowsFor(table: string, filters: Record<string, unknown>): Record<string, unknown> | null {
    if (table === 'credentials') {
        return filters.id === CREDENTIAL_ID ? state.credential : null;
    }
    if (table === 'students') {
        return filters.id === 'student-1' && filters.auth_user_id === HOLDER ? { id: 'student-1' } : null;
    }
    if (table === 'institution_users') {
        return filters.institution_id === 'inst-1' &&
            filters.auth_user_id === MEMBER &&
            filters.status === 'active'
            ? { id: 'membership-1' }
            : null;
    }
    if (table === 'institutions') {
        return filters.id === 'inst-1' && filters.auth_user_id === OWNER ? { id: 'inst-1' } : null;
    }
    return null;
}

vi.mock('@/lib/serverAuth', () => ({
    requireAuthenticatedRequest: state.requireAuth,
    getServiceRoleClient: () => ({
        from: (table: string) => {
            const filters: Record<string, unknown> = {};
            const query = {
                select: () => query,
                eq: (column: string, value: unknown) => {
                    filters[column] = value;
                    return query;
                },
                maybeSingle: async () => ({ data: rowsFor(table, filters), error: null }),
            };
            return query;
        },
        storage: { from: state.bucket },
    }),
}));

import { GET } from '@/app/api/credentials/[id]/document/route';

let ip = 0;
async function requestDocument(id = CREDENTIAL_ID) {
    ip += 1;
    const response = await GET(
        new NextRequest(`http://localhost/api/credentials/${id}/document`, {
            headers: { 'x-forwarded-for': `203.0.113.${ip % 250}` },
        }),
        { params: Promise.resolve({ id }) },
    );
    return { response, payload: await response.json() };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    state.credential = {
        id: CREDENTIAL_ID,
        student_id: 'student-1',
        institution_id: 'inst-1',
        document_path: 'inst-1/doc.pdf',
        document_sha256: 'd'.repeat(64),
    };
    state.requireAuth.mockImplementation(async () => ({ ok: true, userId: state.userId }));
    state.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null });
    state.bucket.mockReturnValue({ createSignedUrl: state.createSignedUrl });
});

describe('GET /api/credentials/:id/document', () => {
    it.each([
        ['the holder', HOLDER],
        ['an active member of the issuing institution', MEMBER],
        ['the institution’s legacy owner account', OWNER],
    ])('gives %s a short-lived signed URL', async (_label, userId) => {
        state.userId = userId;

        const { response, payload } = await requestDocument();

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(payload).toEqual({
            success: true,
            url: 'https://storage.test/signed',
            sha256: 'd'.repeat(64),
            expiresInSeconds: 300,
        });
        expect(state.bucket).toHaveBeenCalledWith('credential-documents');
        expect(state.createSignedUrl).toHaveBeenCalledWith('inst-1/doc.pdf', 300);
    });

    it('answers anyone else with the same 404 as a missing credential', async () => {
        state.userId = STRANGER;
        const denied = await requestDocument();

        state.credential = null;
        const missing = await requestDocument();

        expect(denied.response.status).toBe(404);
        expect(denied.payload).toEqual(missing.payload);
        expect(state.createSignedUrl).not.toHaveBeenCalled();
    });

    it('does not let a member of another institution in', async () => {
        state.userId = MEMBER;
        state.credential = { ...state.credential, institution_id: 'inst-2', student_id: 'student-9' };

        expect((await requestDocument()).response.status).toBe(404);
    });

    it('requires a signed-in caller', async () => {
        state.requireAuth.mockResolvedValue({ ok: false, status: 401, error: 'Missing access token' });

        const { response } = await requestDocument();

        expect(response.status).toBe(401);
        expect(state.createSignedUrl).not.toHaveBeenCalled();
    });

    it('returns 404 for a credential without a document', async () => {
        state.userId = HOLDER;
        state.credential = { ...state.credential, document_path: null, document_sha256: null };

        expect((await requestDocument()).response.status).toBe(404);
    });

    it('returns 404 for a malformed id without querying', async () => {
        state.userId = HOLDER;
        expect((await requestDocument('not-a-uuid')).response.status).toBe(404);
    });

    it('reports a signing failure as 500 without details', async () => {
        state.userId = HOLDER;
        state.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'bucket offline' } });

        const { response, payload } = await requestDocument();

        expect(response.status).toBe(500);
        expect(payload).toEqual({ success: false, error: 'Failed to load the document.' });
    });
});
