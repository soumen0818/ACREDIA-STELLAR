import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';
import {
    CREDENTIAL_DOCUMENTS_BUCKET,
    documentEvidenceId,
    sha256Hex,
    validateCredentialDocument,
} from '@/lib/credentialDocuments';

/**
 * Private credential documents (review §3.11): the upload route stores files
 * in a private bucket under the institution's folder and returns their
 * SHA-256, which the credential JSON records.
 */

const { mockRequireInstitutionRequest, mockGetServiceRoleClient, upload } = vi.hoisted(() => ({
    mockRequireInstitutionRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    upload: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireInstitutionRequest: mockRequireInstitutionRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));

import { POST } from '../src/app/api/institution/documents/route';

const ISSUER = { ok: true, userId: 'user-1', institutionId: 'inst-1', memberRole: 'issuer' };

let ip = 0;
function request(file?: File | null): NextRequest {
    ip += 1;
    const formData = new FormData();
    if (file !== null) {
        const body =
            file ??
            new File([new TextEncoder().encode('%PDF diploma')], 'Diploma.pdf', {
                type: 'application/pdf',
            });
        formData.append('file', body, body.name);
    }
    return new NextRequest('http://localhost/api/institution/documents', {
        method: 'POST',
        headers: { 'x-forwarded-for': `198.51.100.${ip % 250}` },
        body: formData,
    });
}

const bucket = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    upload.mockResolvedValue({ data: {}, error: null });
    bucket.mockReturnValue({ upload });
    mockGetServiceRoleClient.mockReturnValue({ storage: { from: bucket } });
    mockRequireInstitutionRequest.mockResolvedValue(ISSUER);
});

describe('POST /api/institution/documents', () => {
    it('stores the file privately under the institution and returns its SHA-256', async () => {
        const res = await POST(request());
        const body = await res.json();

        const expected = createHash('sha256').update('%PDF diploma').digest('hex');
        expect(res.status).toBe(200);
        expect(body).toMatchObject({ success: true, sha256: expected });
        // Random name in the institution's folder: nothing about the student.
        expect(body.path).toMatch(/^inst-1\/[0-9a-f-]{36}\.pdf$/);
        expect(bucket).toHaveBeenCalledWith(CREDENTIAL_DOCUMENTS_BUCKET);
        expect(upload).toHaveBeenCalledWith(body.path, expect.any(Uint8Array), {
            contentType: 'application/pdf',
            upsert: false,
        });
    });

    it('refuses callers who are not signed in as an institution', async () => {
        mockRequireInstitutionRequest.mockResolvedValue({
            ok: false,
            status: 401,
            error: 'Missing access token',
        });
        const res = await POST(request());
        expect(res.status).toBe(401);
        expect(upload).not.toHaveBeenCalled();
    });

    it('refuses read-only members', async () => {
        mockRequireInstitutionRequest.mockResolvedValue({ ...ISSUER, memberRole: 'viewer' });
        const res = await POST(request());
        expect(res.status).toBe(403);
        expect(upload).not.toHaveBeenCalled();
    });

    it('refuses an account with no institution', async () => {
        mockRequireInstitutionRequest.mockResolvedValue({ ...ISSUER, institutionId: null });
        const res = await POST(request());
        expect(res.status).toBe(403);
        expect(upload).not.toHaveBeenCalled();
    });

    it.each([
        ['no file', null],
        ['a disallowed type', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })],
        ['an empty file', new File([], 'empty.pdf', { type: 'application/pdf' })],
    ])('rejects %s with 400', async (_label, file) => {
        const res = await POST(request(file as File | null));
        expect(res.status).toBe(400);
        expect(upload).not.toHaveBeenCalled();
    });

    it('reports a storage failure as 500 without leaking details', async () => {
        upload.mockResolvedValue({ data: null, error: { message: 'bucket offline' } });
        const res = await POST(request());
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(body.error).toBe('Failed to store the document.');
    });
});

describe('credential document helpers', () => {
    it('validates type and size', () => {
        expect(validateCredentialDocument({ type: 'image/png', size: 10 })).toBeNull();
        expect(validateCredentialDocument({ type: 'text/html', size: 10 })).toMatch(
            /Invalid file type/,
        );
        expect(
            validateCredentialDocument({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }),
        ).toMatch(/10MB/);
    });

    it('hashes like Node and builds the evidence id from the digest', async () => {
        const bytes = new TextEncoder().encode('abc');
        const hex = await sha256Hex(bytes);
        expect(hex).toBe(createHash('sha256').update('abc').digest('hex'));
        expect(documentEvidenceId(hex)).toBe(`urn:sha256:${hex}`);
    });
});
