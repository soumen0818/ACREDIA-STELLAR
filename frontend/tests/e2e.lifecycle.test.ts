import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── HOISTED MOCK VARIABLES ───────────────────────────────────────────────────
// Vitest hoists vi.mock calls, so any variables used inside must be created with vi.hoisted
const {
    mockIssueCredentialOnStellar,
    mockGetServiceRoleClient,
    mockGetCredential,
    mockIsRevoked,
    mockSupabaseInsert,
    mockVerificationLogInsert,
    mockSupabaseMaybeSingle,
    mockRequireAdminRequest,
} = vi.hoisted(() => ({
    mockIssueCredentialOnStellar: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
    mockGetCredential: vi.fn(),
    mockIsRevoked: vi.fn(),
    mockSupabaseInsert: vi.fn(),
    mockVerificationLogInsert: vi.fn(),
    mockSupabaseMaybeSingle: vi.fn(),
    mockRequireAdminRequest: vi.fn(),
}));

// Documents go to private storage, not IPFS (review §3.11).
vi.mock('../src/lib/credentialDocumentUpload', () => ({
    uploadCredentialDocument: vi.fn(async () => ({
        path: 'inst-999/diploma.pdf',
        sha256: 'd'.repeat(64),
    })),
}));

// Mock Stellar/Freighter contracts
vi.mock('../src/lib/contracts', () => ({
    issueCredentialOnStellar: mockIssueCredentialOnStellar,
    generateCredentialHash: vi.fn(
        async () => '850e0cdb283df84c2f61e80821d3e80821d3e80821d3e80821d3e80821d3e808',
    ),
    revokeCredentialOnStellar: vi.fn(),
    isValidAddress: vi.fn(() => true),
}));

// Mock serverAuth
vi.mock('../src/lib/serverAuth', () => ({
    getServiceRoleClient: mockGetServiceRoleClient,
    requireAdminRequest: mockRequireAdminRequest,
}));

// Mock the contract reads: verification reads the chain only (review §3.11b).
vi.mock('../src/lib/contractReads', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/contractReads')>()),
    getCredentialFromChain: mockGetCredential,
    isRevokedFromChain: mockIsRevoked,
    isAuthorizedIssuerOnChain: vi.fn().mockResolvedValue(true),
}));

// Mock Supabase
vi.mock('../src/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle: mockSupabaseMaybeSingle,
                })),
            })),
            upsert: mockSupabaseInsert,
        })),
    },
}));

// Import target services after mocks are established
import { issueCredential, type CredentialData } from '../src/lib/credentialService';
import { Keypair } from '@stellar/stellar-sdk';
import { createKeypairSigner } from '../src/lib/stellarSigner';
import { GET } from '../src/app/api/verify/[token]/route';
import { GET as adminStatsGET } from '../src/app/api/admin/stats/route';
import {
    CREDENTIAL_HASH_ALGORITHM,
    CREDENTIAL_METADATA_SCHEMA_VERSION,
} from '../src/lib/credentialHash';

/** The verify route reads display labels only: the credential row and the institution name. */
function mockVerifyRouteClient(credentialResponse: unknown) {
    const mockMaybeSingle = vi.fn().mockResolvedValue(credentialResponse);
    const from = vi.fn((table: string) => {
        if (table === 'verification_logs') {
            return {
                insert: mockVerificationLogInsert,
            };
        }

        return {
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle:
                        table === 'institutions'
                            ? vi.fn().mockResolvedValue({ data: { name: 'Acredia Academy' }, error: null })
                            : mockMaybeSingle,
                })),
            })),
        };
    });

    mockGetServiceRoleClient.mockReturnValue({ from });
    return { from, mockMaybeSingle };
}

function expectVerificationLog(resultType: string, credentialId: string | null) {
    expect(mockVerificationLogInsert).toHaveBeenCalledWith(
        expect.objectContaining({
            credential_id: credentialId,
            verifier_email: null,
            verifier_org: null,
            verification_result: expect.objectContaining({
                result_type: resultType,
                token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        }),
    );
}

// ── CORE LIFECYCLE TESTS ──────────────────────────────────────────────────────

// Issuance takes a StellarSigner rather than an address (ACREDIA-STELLAR#3).
// A keypair signer needs no browser and no wallet extension.
const issuerSigner = createKeypairSigner(Keypair.random());

describe('Academic Credential E2E Integration / Lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockVerificationLogInsert.mockResolvedValue({ error: null });
    });

    const dummyFile = new File([new Uint8Array(100)], 'diploma.pdf', {
        type: 'application/pdf',
    });

    const mockCredentialData: CredentialData = {
        studentName: 'Alice Smith',
        studentWallet: 'GSTUDENTADDRESS123456789012345678901234567890123456789',
        studentEmail: 'alice@example.com',
        credentialType: 'diploma',
        degree: 'Bachelor of Computer Science',
        major: 'Software Engineering',
        gpa: '3.9',
        issueDate: '2026-05-31',
        institutionId: 'inst-999',
        institutionName: 'Acredia Academy',
        institutionWallet: 'GINSTITUTIONADDRESS12345678901234567890123456789',
        file: dummyFile,
    };

    // ── 1. SUCCESSFUL CREDENTIAL ISSUANCE ──────────────────────────────────────
    it('covers successful credential issuance lifecycle', async () => {
        // Setup mocks
        mockIssueCredentialOnStellar.mockResolvedValue({
            tokenId: '123',
            transactionHash: 'mocked-transaction-hash',
        });
        mockSupabaseMaybeSingle.mockResolvedValue({
            data: { id: 'student-db-id-001' },
            error: null,
        });
        mockSupabaseInsert.mockResolvedValue({
            data: null,
            error: null,
        });

        const result = await issueCredential(mockCredentialData, issuerSigner);

        expect(result).toEqual({
            tokenId: '123',
            transactionHash: 'mocked-transaction-hash',
        });

        expect(mockSupabaseInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                student_wallet_address: mockCredentialData.studentWallet,
                token_id: '123',
                ipfs_hash: null,
                document_path: 'inst-999/diploma.pdf',
                document_sha256: 'd'.repeat(64),
                expires_at: null,
                blockchain_hash: 'mocked-transaction-hash',
                metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
                hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
                revoked: false,
            }),
            // Completes a row the indexer may have written first (review §3.11c).
            { onConflict: 'token_id' },
        );
    });

    it('passes an optional expiry to the contract and stores it', async () => {
        mockIssueCredentialOnStellar.mockResolvedValue({
            tokenId: '124',
            transactionHash: 'mocked-transaction-hash',
        });
        mockSupabaseMaybeSingle.mockResolvedValue({
            data: { id: 'student-db-id-001' },
            error: null,
        });
        mockSupabaseInsert.mockResolvedValue({ data: null, error: null });

        // Valid through 2099-12-31 (UTC) => expires at 2100-01-01T00:00:00Z.
        await issueCredential({ ...mockCredentialData, expiresAt: '2099-12-31' }, issuerSigner);

        expect(mockIssueCredentialOnStellar).toHaveBeenCalledWith(
            mockCredentialData.studentWallet,
            expect.any(String),
            Date.UTC(2100, 0, 1) / 1000,
            issuerSigner,
        );
        expect(mockSupabaseInsert).toHaveBeenCalledWith(
            expect.objectContaining({ expires_at: '2100-01-01T00:00:00.000Z' }),
            { onConflict: 'token_id' },
        );
    });

    // ── 2. FAILED WALLET SIGNING ──────────────────────────────────────────────
    it('covers failed wallet signing during issuance', async () => {
        // The signer rejects, standing in for a cancelled wallet prompt.
        mockIssueCredentialOnStellar.mockRejectedValue(
            new Error('Transaction signing was canceled by the user.'),
        );
        mockSupabaseMaybeSingle.mockResolvedValue({
            data: { id: 'student-db-id-001' },
            error: null,
        });

        await expect(issueCredential(mockCredentialData, issuerSigner)).rejects.toThrow(
            'Transaction signing was canceled by the user.',
        );

        // Database insert must NEVER be called if signing fails
        expect(mockSupabaseInsert).not.toHaveBeenCalled();
    });

    // ── 3–5. STATUS VERIFICATION ─────────────────────────────────────────────
    // A token ID shows status only, read from the contract (review §3.11b).
    // Whether a credential's content is the one issued is checked through
    // the holder's share link, not here.
    const ISSUER = 'GINSTITUTIONADDRESS12345678901234567890123456789';
    const issuedOnChain = {
        tokenId: '123',
        student: 'GSTUDENTADDRESS123456789012345678901234567890123456789',
        issuer: ISSUER,
        hash: 'ab'.repeat(32),
        issuedAt: 1717146000,
        expiresAt: null,
        revoked: false,
    };

    async function verifyToken(token: string) {
        const req = new NextRequest(`http://localhost:3000/api/verify/${token}`);
        const response = await GET(req, { params: Promise.resolve({ token }) });
        return { response, payload: await response.json() };
    }

    it('covers verification success states', async () => {
        mockVerifyRouteClient({
            data: { id: 'cred-001', revoked_at: null, revocation_source: null },
            error: null,
        });
        mockGetCredential.mockResolvedValue(issuedOnChain);
        mockIsRevoked.mockResolvedValue(false);

        const { response, payload } = await verifyToken('123');

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(true);
        expect(payload.credential).toMatchObject({
            status: 'valid',
            institutionName: 'Acredia Academy',
            institutionWallet: ISSUER,
            issuedAt: '2024-05-31T09:00:00.000Z',
        });
        expect(payload.credential).not.toHaveProperty('studentWallet');
        expectVerificationLog('verified', 'cred-001');
    });

    it('covers verification revoked states', async () => {
        // Active in the database, revoked on-chain: the chain wins.
        mockVerifyRouteClient({
            data: { id: 'cred-001', revoked_at: null, revocation_source: null },
            error: null,
        });
        mockGetCredential.mockResolvedValue(issuedOnChain);
        mockIsRevoked.mockResolvedValue(true);

        const { response, payload } = await verifyToken('123');

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(false);
        expect(payload.verification.revoked).toBe(true);
        expect(payload.credential.status).toBe('revoked');
        expectVerificationLog('revoked', 'cred-001');
    });

    it('covers verification not found states', async () => {
        // A database row does not make a credential exist: only the chain does.
        mockVerifyRouteClient({
            data: { id: 'cred-999', revoked_at: null, revocation_source: null },
            error: null,
        });
        mockGetCredential.mockResolvedValueOnce(null);

        const { response, payload } = await verifyToken('999');

        expect(response.status).toBe(404);
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('Credential not found');
        expectVerificationLog('not_found', null);
    });

    // ── 7. ROLE-BASED ROUTE ACCESS ────────────────────────────────────────────
    it('covers role-based route access validation', async () => {
        // Assert route guard integrates with requireAdminRequest helper via actual GET handler

        // 1. Simulating unauthorized/non-admin requester
        mockRequireAdminRequest.mockResolvedValue({
            ok: false,
            status: 403,
            error: 'Admin access required',
        });
        const reqFailed = new NextRequest('http://localhost:3000/api/admin/stats');
        const responseFailed = await adminStatsGET(reqFailed);

        expect(responseFailed.status).toBe(403);
        const bodyFailed = await responseFailed.json();
        expect(bodyFailed.success).toBe(false);
        expect(bodyFailed.error).toBe('Admin access required');

        // 2. Simulating authorized admin
        mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-user-007' });

        // Mock the database client to successfully return some simple count/data for all queries in stats route
        const mockDbChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: { last_ledger: 0, updated_at: null },
                error: null,
            }),
            then: vi.fn().mockImplementation((resolve) => {
                resolve({ count: 5, data: [], error: null });
            }),
        };
        mockGetServiceRoleClient.mockReturnValue({
            from: vi.fn().mockReturnValue(mockDbChain),
        });

        const reqSuccess = new NextRequest('http://localhost:3000/api/admin/stats');
        const responseSuccess = await adminStatsGET(reqSuccess);

        expect(responseSuccess.status).toBe(200);
        const bodySuccess = await responseSuccess.json();
        expect(bodySuccess.success).toBe(true);
        expect(bodySuccess.stats).toEqual({
            totalInstitutions: 5,
            authorizedInstitutions: 0,
            totalCredentials: 5,
            activeCredentials: 5,
            totalStudents: 5,
            verificationActivity: {
                totalAttempts: 5,
                attemptsLast24h: 5,
                resultCounts: {
                    verified: 5,
                    revoked: 5,
                    expired: 5,
                    not_found: 5,
                    chain_unavailable: 5,
                    mismatch: 5,
                    invalid_request: 5,
                    server_error: 5,
                },
            },
            indexer: {
                lastLedger: null,
                lastUpdated: null,
            },
            ttlKeeper: {
                lastRunId: null,
                lastRunAt: null,
                lastRunStatus: null,
                lastRunSummary: null,
            },
            // Surfaced so a deployment that never configured Upstash is visible
            // in the admin console rather than silently degrading to
            // per-instance limits. No UPSTASH_REDIS_* vars exist under test.
            rateLimiterMode: 'in-memory-unconfigured',
        });
    });
});
