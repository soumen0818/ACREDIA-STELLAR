import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';
import { BlockchainUnavailableError } from '@/lib/contractReads';
import {
    CREDENTIAL_HASH_ALGORITHM_V2,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
    deriveCredentialHash,
} from '@/lib/credentialHash';
import { documentEvidenceId } from '@/lib/credentialDocuments';
import { buildAcrediaVerifiableCredential } from '@/lib/verifiableCredential';
import type { OnChainStatus } from '@/lib/onChainStatus';

/** GET /api/credentials/share/:shareToken (review §3.11b). */

const SHARE_TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const STUDENT = 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD';
const DIGEST = 'd'.repeat(64);

const db = vi.hoisted(() => ({
    row: null as Record<string, unknown> | null,
    shareLookups: [] as string[],
    logInsert: vi.fn(),
    createSignedUrl: vi.fn(),
    bucket: vi.fn(),
}));

const chain = vi.hoisted(() => ({ readOnChainStatus: vi.fn() }));

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: (table: string) => ({
            select: () => ({
                eq: (column: string, value: string) => {
                    if (column === 'share_token') db.shareLookups.push(value);
                    return {
                        maybeSingle: async () => ({
                            data: table === 'institutions' ? { name: 'Uni Example' } : db.row,
                            error: null,
                        }),
                    };
                },
            }),
            insert: db.logInsert,
        }),
        storage: { from: db.bucket },
    }),
}));

vi.mock('@/lib/onChainStatus', () => chain);

import { GET } from '@/app/api/credentials/share/[shareToken]/route';

function issuedMetadata() {
    return buildAcrediaVerifiableCredential(
        {
            studentName: 'Ada Lovelace',
            studentWallet: STUDENT,
            degree: 'BSc Computer Science',
            issueDate: '2026-06-01',
            credentialType: 'diploma',
            institutionName: 'Uni Example',
            institutionWallet: 'GISSUER',
        },
        'https://stellar.expert/explorer/testnet',
        { id: documentEvidenceId(DIGEST), description: 'Original document' },
    );
}

let metadata: ReturnType<typeof issuedMetadata>;
let onChainHash: string;

function chainStatus(overrides: Partial<OnChainStatus> = {}): OnChainStatus {
    return {
        onChain: {
            tokenId: '7',
            student: STUDENT,
            issuer: 'GISSUER',
            hash: onChainHash,
            issuedAt: 1_780_000_000,
            expiresAt: null,
            revoked: false,
        },
        status: 'valid',
        revoked: false,
        issuerAuthorized: true,
        cache: { immutableHit: false, revocationHit: false },
        ...overrides,
    };
}

let ip = 0;
async function share(token = SHARE_TOKEN) {
    ip += 1;
    const response = await GET(
        new NextRequest(`http://localhost/api/credentials/share/${token}`, {
            headers: { 'x-forwarded-for': `198.51.100.${ip % 250}` },
        }),
        { params: Promise.resolve({ shareToken: token }) },
    );
    return { response, payload: await response.json() };
}

beforeEach(async () => {
    vi.clearAllMocks();
    resetRateLimitStore();
    db.shareLookups = [];
    metadata = issuedMetadata();
    onChainHash = await deriveCredentialHash(
        metadata,
        CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
        CREDENTIAL_HASH_ALGORITHM_V2,
    );
    db.row = {
        id: 'cred-7',
        token_id: '7',
        metadata,
        metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
        hash_algorithm: CREDENTIAL_HASH_ALGORITHM_V2,
        document_path: 'inst-1/doc.pdf',
        document_sha256: DIGEST,
        blockchain_hash: 'tx-7',
        revoked_at: null,
        revocation_source: null,
    };
    db.logInsert.mockResolvedValue({ error: null });
    db.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null });
    db.bucket.mockReturnValue({ createSignedUrl: db.createSignedUrl });
    chain.readOnChainStatus.mockResolvedValue(chainStatus());
});

describe('GET /api/credentials/share/:shareToken', () => {
    it('shows the verified content, holder and a short-lived document link', async () => {
        const { response, payload } = await share();

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(chain.readOnChainStatus).toHaveBeenCalledWith('7');
        expect(payload.credential).toMatchObject({
            tokenId: '7',
            status: 'valid',
            institutionName: 'Uni Example',
            studentWallet: STUDENT,
            transactionHash: 'tx-7',
            details: { studentName: 'Ada Lovelace', degree: 'BSc Computer Science' },
            // The exact anchored document, as JSON carries it.
            metadata: JSON.parse(JSON.stringify(metadata)),
            document: {
                url: 'https://storage.test/signed',
                sha256: DIGEST,
                expiresInSeconds: 300,
            },
            documentStatus: 'available',
        });
        expect(payload.verification).toMatchObject({
            verified: true,
            contentMatches: true,
            mismatchReason: null,
        });
        expect(db.bucket).toHaveBeenCalledWith('credential-documents');
        expect(db.createSignedUrl).toHaveBeenCalledWith('inst-1/doc.pdf', 300);
        expect(db.logInsert.mock.calls[0][0].verification_result).toMatchObject({
            result_type: 'verified',
        });
    });

    it('looks the token up in lower case', async () => {
        await share(SHARE_TOKEN.toUpperCase());
        expect(db.shareLookups).toEqual([SHARE_TOKEN]);
    });

    it.each(['7', 'not-a-token', `${SHARE_TOKEN}x`])(
        'answers a malformed token %j with 404 and no lookup',
        async (token) => {
            const { response, payload } = await share(token);

            expect(response.status).toBe(404);
            expect(payload).toEqual({ success: false, error: 'Credential not found' });
            expect(db.shareLookups).toEqual([]);
        },
    );

    it('returns 404 for an unknown share token', async () => {
        db.row = null;
        expect((await share()).response.status).toBe(404);
        expect(chain.readOnChainStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when the contract has no such credential', async () => {
        chain.readOnChainStatus.mockResolvedValue(null);
        expect((await share()).response.status).toBe(404);
    });

    it('withholds content, metadata and document when the stored content was edited', async () => {
        db.row = {
            ...db.row,
            metadata: { ...metadata, credentialData: { ...metadata.credentialData, degree: 'PhD' } },
        };

        const { response, payload } = await share();

        expect(response.status).toBe(200);
        expect(payload.credential).toMatchObject({
            details: null,
            metadata: null,
            document: null,
            documentStatus: 'none',
        });
        expect(payload.verification).toMatchObject({
            verified: false,
            contentMatches: false,
            mismatchReason: 'hash_mismatch',
        });
        expect(JSON.stringify(payload)).not.toContain('PhD');
        expect(db.createSignedUrl).not.toHaveBeenCalled();
        expect(db.logInsert.mock.calls[0][0].verification_result).toMatchObject({
            result_type: 'mismatch',
            mismatch_reasons: ['hash_mismatch'],
        });
    });

    it('does not serve a document whose stored digest differs from the anchored one', async () => {
        db.row = { ...db.row, document_sha256: 'e'.repeat(64) };

        const { payload } = await share();

        expect(payload.credential).toMatchObject({ document: null, documentStatus: 'unavailable' });
        // The content itself still verified.
        expect(payload.verification.verified).toBe(true);
        expect(db.createSignedUrl).not.toHaveBeenCalled();
    });

    it('reports a document as unavailable when signing fails', async () => {
        db.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'storage down' } });
        const { payload } = await share();
        expect(payload.credential).toMatchObject({ document: null, documentStatus: 'unavailable' });
    });

    it('reports a revoked credential as not verified, labelled from the row', async () => {
        db.row = { ...db.row, revoked_at: '2027-01-01T00:00:00Z', revocation_source: 'issuer' };
        chain.readOnChainStatus.mockResolvedValue(chainStatus({ status: 'revoked', revoked: true }));

        const { payload } = await share();

        expect(payload.credential).toMatchObject({
            status: 'revoked',
            revokedAt: '2027-01-01T00:00:00Z',
            revocationSource: 'issuer',
        });
        expect(payload.verification).toMatchObject({ verified: false, contentMatches: true });
    });

    it('ignores revocation labels in the row while the contract says not revoked', async () => {
        db.row = { ...db.row, revoked_at: '2027-01-01T00:00:00Z', revocation_source: 'platform' };

        const { payload } = await share();

        expect(payload.credential).toMatchObject({ revokedAt: null, revocationSource: null });
    });

    it('reports an expired credential as not verified', async () => {
        chain.readOnChainStatus.mockResolvedValue(chainStatus({ status: 'expired' }));

        const { payload } = await share();

        expect(payload.verification).toMatchObject({ verified: false, expired: true, status: 'expired' });
    });

    it('fails closed with 503 when the chain cannot be read', async () => {
        chain.readOnChainStatus.mockRejectedValue(new BlockchainUnavailableError('rpc down'));

        const { response, payload } = await share();

        expect(response.status).toBe(503);
        expect(payload).toEqual({ success: false, error: 'Blockchain verification unavailable' });
    });
});
