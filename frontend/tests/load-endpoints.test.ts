import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { performance } from 'node:perf_hooks';
import { resetRateLimitStore } from '@/lib/rateLimit';

const {
    mockIssueCredentialOnStellar,
    mockGetServiceRoleClient,
    mockGetCredential,
    mockIsRevoked,
    mockSupabaseInsert,
    mockVerificationLogInsert,
    mockSupabaseMaybeSingle,
    mockRequireInstitutionRequest,
    mockStorageUpload,
    mockRequireAdminRequest,
} = vi.hoisted(() => ({
    mockIssueCredentialOnStellar: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockGetCredential: vi.fn(),
    mockIsRevoked: vi.fn(),
    mockSupabaseInsert: vi.fn(),
    mockVerificationLogInsert: vi.fn(),
    mockSupabaseMaybeSingle: vi.fn(),
    mockRequireInstitutionRequest: vi.fn(),
    mockStorageUpload: vi.fn(),
    mockRequireAdminRequest: vi.fn(),
}));

vi.mock('../src/lib/contracts', () => ({
    issueCredentialOnStellar: mockIssueCredentialOnStellar,
    generateCredentialHash: vi.fn(async () => '850e0cdb283df84c2f61e80821d3e80821d3e80821d3e80821d3e80821d3e808'),
    revokeCredentialOnStellar: vi.fn(),
    isValidAddress: vi.fn(() => true),
}));

vi.mock('../src/lib/serverAuth', () => ({
    getServiceRoleClient: mockGetServiceRoleClient,
    requireAdminRequest: mockRequireAdminRequest,
    requireInstitutionRequest: mockRequireInstitutionRequest,
}));

vi.mock('../src/lib/contractReads', () => ({
    ContractConfigurationError: class ContractConfigurationError extends Error {},
    BlockchainUnavailableError: class BlockchainUnavailableError extends Error {},
    CredentialNotFoundError: class CredentialNotFoundError extends Error {},
    getCredentialFromChain: mockGetCredential,
    isRevokedFromChain: mockIsRevoked,
    isAuthorizedIssuerOnChain: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle: mockSupabaseMaybeSingle,
                })),
            })),
            insert: mockSupabaseInsert,
        })),
    },
}));

import { GET as verifyGET } from '../src/app/api/verify/[token]/route';
import { POST as postDocument } from '../src/app/api/institution/documents/route';

function percentile(values: number[], quantile: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.ceil(sorted.length * quantile) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function measure<T>(label: string, iterations: number, fn: (index: number) => Promise<T>) {
    const durations: number[] = [];

    for (let index = 0; index < iterations; index += 1) {
        const started = performance.now();
        await fn(index);
        durations.push(performance.now() - started);
    }

    const summary = {
        label,
        iterations,
        p50: Number(percentile(durations, 0.5).toFixed(2)),
        p95: Number(percentile(durations, 0.95).toFixed(2)),
        mean: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)),
    };

    // eslint-disable-next-line no-console
    console.log(`[load] ${label}`, summary);
    return summary;
}

function createVerifyRequest(token: string, index = 0) {
    return new NextRequest(`http://localhost:3000/api/verify/${token}`, {
        headers: { 'x-forwarded-for': `203.0.115.${10 + index}` },
    });
}

function createDocumentRequest(index = 0) {
    const file = new File([new Uint8Array(64)], 'credential.pdf', { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', file, file.name);

    return new NextRequest('http://localhost:3000/api/institution/documents', {
        method: 'POST',
        headers: {
            'x-forwarded-for': `203.0.113.${11 + index}`,
        },
        body: formData,
    });
}

describe('endpoint load baselines', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetRateLimitStore();

        mockIssueCredentialOnStellar.mockResolvedValue({
            tokenId: '123',
            transactionHash: 'mocked-transaction-hash',
        });
        mockSupabaseMaybeSingle.mockResolvedValue({
            data: {
                id: 'cred-001',
                token_id: '123',
                issued_at: '2026-05-31T09:00:00Z',
                revoked: false,
                revoked_at: null,
                metadata: {
                    credentialData: {
                        studentName: 'Ada Lovelace',
                        credentialType: 'diploma',
                    },
                },
                metadata_schema_version: 1,
                hash_algorithm: 'sha256:canonical-json:v1',
                ipfs_hash: 'mocked-metadata-path',
                student_wallet_address: 'gstudentaddress123456789012345678901234567890123456789',
                issuer_wallet_address: 'ginstitutionaddress12345678901234567890123456789',
                institution: { name: 'Acredia Academy' },
            },
            error: null,
        });
        mockGetCredential.mockResolvedValue({
            tokenId: '123',
            student: 'gstudentaddress123456789012345678901234567890123456789',
            issuer: 'ginstitutionaddress12345678901234567890123456789',
            hash: '850e0cdb283df84c2f61e80821d3e80821d3e80821d3e80821d3e80821d3e808',
            issuedAt: 1717146000,
            expiresAt: null,
            revoked: false,
        });
        mockIsRevoked.mockResolvedValue(false);
        mockRequireInstitutionRequest.mockResolvedValue({ ok: true, userId: 'institution-user', institutionId: 'institution-1' });
        mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-user' });
        mockStorageUpload.mockResolvedValue({ data: {}, error: null });
        mockVerificationLogInsert.mockResolvedValue({ error: null });
        mockGetServiceRoleClient.mockReturnValue({
            from: (table: string) => {
                if (table === 'verification_logs') {
                    return {
                        insert: mockVerificationLogInsert,
                    };
                }

                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: mockSupabaseMaybeSingle,
                        }),
                    }),
                };
            },
            storage: { from: () => ({ upload: mockStorageUpload }) },
        });
    });

    it('records a verify route baseline', async () => {
        const summary = await measure('verify', 25, async (index) => {
            const response = await verifyGET(createVerifyRequest('123', index), {
                params: Promise.resolve({ token: '123' }),
            });

            expect(response.status, await response.text()).toBe(200);
        });

        expect(summary.p95).toBeLessThanOrEqual(50);
    });

    it('records a credential document upload baseline', async () => {
        const summary = await measure('document-upload', 25, async (index) => {
            mockRequireInstitutionRequest.mockResolvedValueOnce({
                ok: true,
                userId: `institution-user-${index}`,
                institutionId: 'institution-1',
                memberRole: 'issuer',
            });
            const response = await postDocument(createDocumentRequest(index));
            expect(response.status, await response.text()).toBe(200);
        });

        expect(summary.p95).toBeLessThanOrEqual(50);
    });
});
