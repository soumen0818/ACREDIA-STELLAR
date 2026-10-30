import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CsvCredentialRow } from '../src/lib/batchCredentialImport';
import type { BatchIssueOutcome } from '../src/lib/contracts';
import { Keypair } from '@stellar/stellar-sdk';
import { createKeypairSigner } from '../src/lib/stellarSigner';

vi.mock('../src/lib/contracts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/contracts')>();
    return {
        ...actual,
        batchIssueCredentialOnStellar: vi.fn(),
        describeBatchRowError: vi.fn((code: number | null) => `mock-error-${code}`),
        generateCredentialHash: vi.fn().mockResolvedValue('a'.repeat(64)),
    };
});

vi.mock('../src/lib/supabase', () => ({
    supabase: { from: vi.fn() },
}));

const WALLET = 'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU';

function makeRow(overrides: Partial<CsvCredentialRow> = {}): CsvCredentialRow {
    return {
        rowNumber: 1,
        studentName: 'Jane Doe',
        studentWalletAddress: WALLET,
        credentialType: 'diploma',
        degree: 'Bachelor of Science',
        issueDate: '2025-01-01',
        ...overrides,
    };
}

// A real keypair signer, not a stub: the batch path now takes a StellarSigner,
// and building one in a plain Node test is the point of ACREDIA-STELLAR#3.
const issuerKeypair = Keypair.random();

const context = {
    institutionId: 'inst-1',
    institutionName: 'Test University',
    institutionWallet: WALLET,
    issuer: createKeypairSigner(issuerKeypair),
};

function stubSupabase(options: { insertError?: unknown } = {}) {
    const insertMock = vi.fn().mockResolvedValue({ error: options.insertError ?? null });
    const inMock = vi.fn().mockResolvedValue({ data: [], error: null });

    const fromMock = vi.fn((table: string) => {
        if (table === 'students') {
            return { select: vi.fn().mockReturnValue({ in: inMock }) };
        }
        if (table === 'credentials') {
            return { upsert: insertMock };
        }
        throw new Error(`Unexpected table in test: ${table}`);
    });

    return { fromMock, insertMock, inMock };
}

describe('issueBatchCredentials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('issues all valid rows in one chunk and reports success with token IDs', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock, insertMock } = stubSupabase();
        vi.mocked(supabase.from).mockImplementation(fromMock as never);

        const outcome: BatchIssueOutcome = {
            transactionHash: 'tx-1',
            results: [
                { index: 0, success: true, tokenId: '1', errorCode: null },
                { index: 1, success: true, tokenId: '2', errorCode: null },
            ],
        };
        vi.mocked(batchIssueCredentialOnStellar).mockResolvedValue(outcome);

        const rows = [makeRow({ rowNumber: 1 }), makeRow({ rowNumber: 2, studentName: 'John Roe' })];
        const summary = await issueBatchCredentials(rows, context);

        expect(summary.total).toBe(2);
        expect(summary.succeeded).toBe(2);
        expect(summary.failed).toBe(0);
        expect(summary.remainingRows).toEqual([]);
        expect(summary.rows.map((r) => r.tokenId)).toEqual(['1', '2']);
        expect(batchIssueCredentialOnStellar).toHaveBeenCalledTimes(1);
        // Only the hash and optional expiry go on-chain (review §3.11).
        const items = (batchIssueCredentialOnStellar as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(items).toEqual([
            { studentAddress: WALLET, credentialHash: 'a'.repeat(64), expiresAt: null },
            { studentAddress: WALLET, credentialHash: 'a'.repeat(64), expiresAt: null },
        ]);
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(insertMock.mock.calls[0][0]).toHaveLength(2);
        expect(insertMock.mock.calls[0][0][0]).toMatchObject({ ipfs_hash: null, expires_at: null });
        // Completes rows the indexer may have written first (review §3.11c).
        expect(insertMock.mock.calls[0][1]).toEqual({ onConflict: 'token_id' });
    });

    it('passes a row expiry to the contract as Unix seconds and stores it', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock, insertMock } = stubSupabase();
        vi.mocked(supabase.from).mockImplementation(fromMock as never);
        vi.mocked(batchIssueCredentialOnStellar).mockResolvedValue({
            transactionHash: 'tx-1',
            results: [{ index: 0, success: true, tokenId: '1', errorCode: null }],
        });

        // Valid through 2099-12-31 (UTC) => expires at 2100-01-01T00:00:00Z.
        await issueBatchCredentials([makeRow({ expiresAt: '2099-12-31' })], context);

        const expiresAt = Date.UTC(2100, 0, 1) / 1000;
        const items = (batchIssueCredentialOnStellar as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(items[0].expiresAt).toBe(expiresAt);
        expect(insertMock.mock.calls[0][0][0]).toMatchObject({
            expires_at: '2100-01-01T00:00:00.000Z',
        });
    });

    it('never calls the contract for rows that fail pre-validation', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock } = stubSupabase();
        vi.mocked(supabase.from).mockImplementation(fromMock as never);
        vi.mocked(batchIssueCredentialOnStellar).mockResolvedValue({
            transactionHash: 'tx-1',
            results: [{ index: 0, success: true, tokenId: '1', errorCode: null }],
        });

        const rows = [
            makeRow({ rowNumber: 1, studentName: '' }), // invalid: no name
            makeRow({ rowNumber: 2 }),
        ];
        const summary = await issueBatchCredentials(rows, context);

        expect(summary.succeeded).toBe(1);
        expect(summary.failed).toBe(1);
        const failedRow = summary.rows.find((r) => r.rowNumber === 1);
        expect(failedRow?.status).toBe('failed');
        expect(failedRow?.errorMessage).toContain('Please enter student name');
        // Only the valid row should have reached the contract.
        expect(batchIssueCredentialOnStellar).toHaveBeenCalledTimes(1);
        expect((batchIssueCredentialOnStellar as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(1);
    });

    it('maps an in-chunk contract-level row failure to a descriptive error without failing the whole chunk', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar, describeBatchRowError } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock } = stubSupabase();
        vi.mocked(supabase.from).mockImplementation(fromMock as never);
        vi.mocked(batchIssueCredentialOnStellar).mockResolvedValue({
            transactionHash: 'tx-1',
            results: [
                { index: 0, success: true, tokenId: '1', errorCode: null },
                { index: 1, success: false, tokenId: null, errorCode: 3 },
            ],
        });

        const rows = [makeRow({ rowNumber: 1 }), makeRow({ rowNumber: 2, studentName: 'John Roe' })];
        const summary = await issueBatchCredentials(rows, context);

        expect(summary.succeeded).toBe(1);
        expect(summary.failed).toBe(1);
        const failedRow = summary.rows.find((r) => r.rowNumber === 2);
        expect(failedRow?.status).toBe('failed');
        expect(failedRow?.errorMessage).toBe('mock-error-3');
        expect(describeBatchRowError).toHaveBeenCalledWith(3);
    });

    it('stops after a whole-chunk failure and reports untried rows as remainingRows', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock } = stubSupabase();
        vi.mocked(supabase.from).mockImplementation(fromMock as never);

        // 41 rows -> chunks of 20, 20, 1 (MAX_BATCH_CHUNK_SIZE mirrors the
        // contract's real MAX_BATCH_SIZE = 20). First chunk succeeds, second
        // chunk's call throws (e.g. signature cancelled), third chunk must
        // never be attempted.
        vi.mocked(batchIssueCredentialOnStellar)
            .mockResolvedValueOnce({
                transactionHash: 'tx-1',
                results: Array.from({ length: 20 }, (_, i) => ({
                    index: i,
                    success: true,
                    tokenId: String(i + 1),
                    errorCode: null,
                })),
            })
            .mockRejectedValueOnce(new Error('Transaction signing was canceled by the user.'));

        const rows = Array.from({ length: 41 }, (_, i) => makeRow({ rowNumber: i + 1, studentName: `Student ${i + 1}` }));
        const summary = await issueBatchCredentials(rows, context);

        expect(batchIssueCredentialOnStellar).toHaveBeenCalledTimes(2);
        expect(summary.succeeded).toBe(20);
        // total === succeeded + failed always holds: the 1 never-attempted
        // row still counts as "not succeeded" even though it's tracked
        // separately in remainingRows for retry, not as a terminal failure.
        expect(summary.failed).toBe(21);
        expect(summary.total).toBe(summary.succeeded + summary.failed);
        expect(summary.remainingRows).toHaveLength(1);
        expect(summary.remainingRows[0].rowNumber).toBe(41);
        // The 20 rows in the failed chunk are reported failed with the thrown message...
        const chunk2Row = summary.rows.find((r) => r.rowNumber === 21);
        expect(chunk2Row?.status).toBe('failed');
        expect(chunk2Row?.errorMessage).toContain('canceled');
        // ...but the untried row is NOT in `rows` at all, only in remainingRows.
        expect(summary.rows.find((r) => r.rowNumber === 41)).toBeUndefined();
    });

    it('keeps a row marked success if issuance succeeded on-chain even when the DB insert fails', async () => {
        const { supabase } = await import('../src/lib/supabase');
        const { batchIssueCredentialOnStellar } = await import('../src/lib/contracts');
        const { issueBatchCredentials } = await import('../src/lib/batchCredentialService');

        const { fromMock } = stubSupabase({ insertError: { message: 'db unavailable' } });
        vi.mocked(supabase.from).mockImplementation(fromMock as never);
        vi.mocked(batchIssueCredentialOnStellar).mockResolvedValue({
            transactionHash: 'tx-1',
            results: [{ index: 0, success: true, tokenId: '1', errorCode: null }],
        });

        const summary = await issueBatchCredentials([makeRow()], context);

        expect(summary.succeeded).toBe(1);
        expect(summary.rows[0].status).toBe('success');
        expect(summary.rows[0].tokenId).toBe('1');
    });
});

describe('buildBatchIssuanceReportCsv', () => {
    it('renders one CSV line per row with the expected headers', async () => {
        const { buildBatchIssuanceReportCsv } = await import('../src/lib/batchCredentialService');

        const csv = buildBatchIssuanceReportCsv({
            total: 2,
            succeeded: 1,
            failed: 1,
            remainingRows: [],
            rows: [
                {
                    rowNumber: 1,
                    studentName: 'Jane Doe',
                    studentWalletAddress: WALLET,
                    credentialType: 'diploma',
                    degree: 'BSc',
                    status: 'success',
                    tokenId: '1',
                    transactionHash: 'tx-1',
                    errorMessage: null,
                },
                {
                    rowNumber: 2,
                    studentName: 'John, "Jr." Roe',
                    studentWalletAddress: WALLET,
                    credentialType: 'diploma',
                    degree: 'BSc',
                    status: 'failed',
                    tokenId: null,
                    transactionHash: null,
                    errorMessage: 'duplicate hash',
                },
            ],
        });

        const lines = csv.split('\n');
        expect(lines[0]).toBe(
            'row_number,student_name,student_wallet_address,credential_type,degree,status,token_id,transaction_hash,error_message',
        );
        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain('"success"');
        expect(lines[1]).toContain('"1"');
        // Commas and quotes inside a field must be escaped, not break columns.
        expect(lines[2]).toContain('"John, ""Jr."" Roe"');
        expect(lines[2]).toContain('""'); // null token_id/transaction_hash render as empty, not the string "null"
        expect(csv).not.toContain('null');
    });
});
