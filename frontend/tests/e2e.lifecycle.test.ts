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

// Mock IPFS methods
vi.mock('../src/lib/ipfs', () => ({
    uploadToIPFS: vi.fn(async () => 'mocked-file-cid'),
    uploadJSONToIPFS: vi.fn(async () => 'mocked-metadata-path'),
    getIPFSUrl: vi.fn((cid) => `ipfs://${cid}`),
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

// Mock contractReads
vi.mock('../src/lib/contractReads', () => ({
    getCredential: mockGetCredential,
    isRevoked: mockIsRevoked,
    isAuthorizedIssuer: vi.fn().mockResolvedValue(true),
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
            insert: mockSupabaseInsert,
        })),
    },
}));

// Import target services after mocks are established
import { issueCredential, type CredentialData } from '../src/lib/credentialService';
import { GET } from '../src/app/api/verify/[token]/route';
import { GET as adminStatsGET } from '../src/app/api/admin/stats/route';
import {
    CREDENTIAL_HASH_ALGORITHM,
    CREDENTIAL_METADATA_SCHEMA_VERSION,
    generateCanonicalCredentialHash,
} from '../src/lib/credentialHash';

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
                    maybeSingle: mockMaybeSingle,
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

        const result = await issueCredential(
            mockCredentialData,
            'GINSTITUTIONADDRESS12345678901234567890123456789',
        );

        expect(result).toEqual({
            tokenId: '123',
            transactionHash: 'mocked-transaction-hash',
            ipfsHash: 'mocked-file-cid',
            metadataHash: 'mocked-metadata-path',
        });

        expect(mockSupabaseInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                student_wallet_address: mockCredentialData.studentWallet,
                token_id: '123',
                ipfs_hash: 'mocked-metadata-path',
                blockchain_hash: 'mocked-transaction-hash',
                metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
                hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
                revoked: false,
            }),
        );
    });

    // ── 2. FAILED WALLET SIGNING ──────────────────────────────────────────────
    it('covers failed wallet signing during issuance', async () => {
        // Setup Freighter mock to throw an error (signing rejection or timeout)
        mockIssueCredentialOnStellar.mockRejectedValue(
            new Error('Freighter signing failed or was canceled.'),
        );
        mockSupabaseMaybeSingle.mockResolvedValue({
            data: { id: 'student-db-id-001' },
            error: null,
        });

        await expect(
            issueCredential(mockCredentialData, 'GINSTITUTIONADDRESS12345678901234567890123456789'),
        ).rejects.toThrow('Freighter signing failed or was canceled.');

        // Database insert must NEVER be called if signing fails
        expect(mockSupabaseInsert).not.toHaveBeenCalled();
    });

    // ── 3. VERIFICATION SUCCESS ───────────────────────────────────────────────
    it('covers verification success states', async () => {
        const dbMetadata = {
            name: 'diploma - Alice Smith',
            description: 'Academic credential issued by Acredia Academy to Alice Smith',
            image: 'ipfs://mocked-file-cid',
            credentialData: {
                studentName: 'Alice Smith',
                studentWallet: 'gstudentaddress123456789012345678901234567890123456789',
                credentialType: 'diploma',
                degree: 'Bachelor of Computer Science',
                institutionName: 'Acredia Academy',
                issueDate: '2026-05-31',
            },
        };

        const expectedHash = await generateCanonicalCredentialHash(dbMetadata);

        // Mock Supabase service role client to return database credential record
        mockVerifyRouteClient({
            data: {
                id: 'cred-001',
                token_id: '123',
                issued_at: '2026-05-31T09:00:00Z',
                revoked: false,
                revoked_at: null,
                metadata: dbMetadata,
                metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
                hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
                ipfs_hash: 'mocked-metadata-path',
                student_wallet_address: 'gstudentaddress123456789012345678901234567890123456789',
                issuer_wallet_address: 'ginstitutionaddress12345678901234567890123456789',
                institution: {
                    name: 'Acredia Academy',
                },
            },
            error: null,
        });

        // Mock on-chain query to return matching credential
        mockGetCredential.mockResolvedValue({
            student: 'gstudentaddress123456789012345678901234567890123456789',
            issuer: 'ginstitutionaddress12345678901234567890123456789',
            hash: expectedHash, // Dynamically matches computed hash
            uri: 'ipfs://mocked-metadata-path',
            issued_at: 1717146000,
        });

        mockIsRevoked.mockResolvedValue(false);

        // Call verify route
        const req = new NextRequest('http://localhost:3000/api/verify/123');
        const response = await GET(req, { params: Promise.resolve({ token: '123' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(true);
        expect(payload.verification.onChainMatch).toBe(true);
        expectVerificationLog('verified', 'cred-001');
    });

    // ── 4. VERIFICATION REVOKED ───────────────────────────────────────────────
    it('covers verification revoked states', async () => {
        const dbMetadata = {
            credentialData: {
                studentName: 'Alice Smith',
                credentialType: 'diploma',
            },
        };

        const expectedHash = await generateCanonicalCredentialHash(dbMetadata);

        // Mock Supabase service role client to return active record but marked revoked on-chain
        mockVerifyRouteClient({
            data: {
                id: 'cred-001',
                token_id: '123',
                issued_at: '2026-05-31T09:00:00Z',
                revoked: false, // active in DB
                revoked_at: null,
                metadata: dbMetadata,
                metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
                hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
                ipfs_hash: 'mocked-metadata-path',
                student_wallet_address: 'gstudentaddress123456789012345678901234567890123456789',
                issuer_wallet_address: 'ginstitutionaddress12345678901234567890123456789',
            },
            error: null,
        });

        // Mock on-chain query to return matching credential
        mockGetCredential.mockResolvedValue({
            student: 'gstudentaddress123456789012345678901234567890123456789',
            issuer: 'ginstitutionaddress12345678901234567890123456789',
            hash: expectedHash,
            uri: 'ipfs://mocked-metadata-path',
            issued_at: 1717146000,
        });

        // Revoked on-chain!
        mockIsRevoked.mockResolvedValue(true);

        const req = new NextRequest('http://localhost:3000/api/verify/123');
        const response = await GET(req, { params: Promise.resolve({ token: '123' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(false); // Revoked credential is not verified
        expect(payload.verification.revoked).toBe(true);
        expectVerificationLog('revoked', 'cred-001');
    });

    // ── 5. VERIFICATION NOT FOUND ─────────────────────────────────────────────
    it('covers verification not found states', async () => {
        // Mock Supabase to return null (no matching token ID)
        mockVerifyRouteClient({
            data: null,
            error: null,
        });

        const req = new NextRequest('http://localhost:3000/api/verify/999');
        const response = await GET(req, { params: Promise.resolve({ token: '999' }) });
        const payload = await response.json();

        expect(response.status).toBe(404);
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('Credential not found');
        expectVerificationLog('not_found', null);
    });

    // ── 6. VERIFICATION MISMATCH ──────────────────────────────────────────────
    it('covers verification mismatch (tampered metadata/hashes) states', async () => {
        const dbMetadata = {
            credentialData: {
                studentName: 'Alice Smith',
                credentialType: 'diploma',
            },
        };

        // Mock Supabase service role client to return valid metadata
        mockVerifyRouteClient({
            data: {
                id: 'cred-001',
                token_id: '123',
                issued_at: '2026-05-31T09:00:00Z',
                revoked: false,
                revoked_at: null,
                metadata: dbMetadata,
                metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
                hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
                ipfs_hash: 'mocked-metadata-path',
                student_wallet_address: 'gstudentaddress123456789012345678901234567890123456789',
                issuer_wallet_address: 'ginstitutionaddress12345678901234567890123456789',
            },
            error: null,
        });

        // Mock on-chain query to return non-matching credential (e.g. completely different hash)
        mockGetCredential.mockResolvedValue({
            student: 'gstudentaddress123456789012345678901234567890123456789',
            issuer: 'ginstitutionaddress12345678901234567890123456789',
            hash: 'tampered-or-different-hash-value-1234567890', // Hash Mismatch!
            uri: 'ipfs://mocked-metadata-path',
            issued_at: 1717146000,
        });

        mockIsRevoked.mockResolvedValue(false);

        const req = new NextRequest('http://localhost:3000/api/verify/123');
        const response = await GET(req, { params: Promise.resolve({ token: '123' }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.verification.verified).toBe(false); // Tampered hash means not verified
        expect(payload.verification.onChainMatch).toBe(false);
        expect(payload.verification).not.toHaveProperty('checks');
        expectVerificationLog('mismatch', 'cred-001');
        expect(mockVerificationLogInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                verification_result: expect.objectContaining({
                    mismatch_reasons: expect.arrayContaining(['hash']),
                }),
            }),
        );
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
                    not_found: 5,
                    chain_unavailable: 5,
                    mismatch: 5,
                    invalid_request: 5,
                    server_error: 5,
                },
            },
        });
    });
});
