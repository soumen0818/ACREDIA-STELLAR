import { supabase } from './supabase';
import { expiryDateToTimestamp } from './credentialValidation';
import {
    batchIssueCredentialOnStellar,
    describeBatchRowError,
    generateCredentialHash,
    type BatchIssueOutcome,
} from './contracts';
import { CREDENTIAL_HASH_ALGORITHM, CREDENTIAL_METADATA_SCHEMA_VERSION } from './credentialHash';
import { buildAcrediaVerifiableCredential, type AcrediaVerifiableCredential } from './verifiableCredential';
import { validateVerifiableCredential } from './schemas';
import { runtimeConfig } from './runtimeConfig';
import { captureException } from './debug';
import { chunkRows, MAX_BATCH_CHUNK_SIZE, validateCsvRows, type CsvCredentialRow } from './batchCredentialImport';
import type { StellarSigner } from './stellarSigner';

export interface BatchIssuanceContext {
    institutionId: string;
    institutionName: string;
    institutionWallet: string;
    /**
     * Who signs each chunk (ACREDIA-STELLAR#3). A signer rather than an
     * address, so this service never needs to know whether the key lives in a
     * browser wallet, a keeper process, or a test.
     */
    issuer: StellarSigner;
}

export interface BatchIssuanceRowReport {
    rowNumber: number;
    studentName: string;
    studentWalletAddress: string;
    credentialType: string;
    degree: string;
    status: 'success' | 'failed';
    tokenId: string | null;
    transactionHash: string | null;
    errorMessage: string | null;
}

export interface BatchIssuanceSummary {
    total: number;
    succeeded: number;
    failed: number;
    rows: BatchIssuanceRowReport[];
    /** Rows from chunks that were never attempted because an earlier chunk failed outright. */
    remainingRows: CsvCredentialRow[];
}

export type BatchIssuancePhase = 'validating' | 'preparing' | 'signing' | 'saving-db';

export interface BatchIssuanceProgress {
    phase: BatchIssuancePhase;
    processedRows: number;
    totalRows: number;
    currentChunk: number;
    totalChunks: number;
}

// Hashing is async (Web Crypto); a CSV may have hundreds of rows, so rows are
// prepared a few at a time rather than all at once.
const PREPARE_CONCURRENCY = 4;

interface PreparedRow {
    row: CsvCredentialRow;
    metadata: AcrediaVerifiableCredential;
    credentialHash: string;
    /** Unix seconds, or null when the credential never expires. */
    expiresAt: number | null;
}

type PrepareOutcome =
    | { status: 'ready'; row: CsvCredentialRow; prepared: PreparedRow }
    | { status: 'failed'; row: CsvCredentialRow; errorMessage: string };

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await fn(items[index]);
        }
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

/**
 * Builds the VC document, validates it and hashes it for one CSV row — the
 * same pipeline credentialService.ts's issueCredential runs per single
 * credential, minus the document upload (batch import is metadata-only;
 * `evidenceUrl` optionally references a document the institution hosts).
 * Nothing goes to IPFS: the JSON is stored privately in the database and only
 * its hash goes on-chain (review §3.11). Failures are caught and returned
 * rather than thrown so one bad row doesn't abort the others.
 */
async function prepareRow(row: CsvCredentialRow, context: BatchIssuanceContext): Promise<PrepareOutcome> {
    try {
        const metadata = buildAcrediaVerifiableCredential(
            {
                studentName: row.studentName,
                studentWallet: row.studentWalletAddress,
                degree: row.degree,
                major: row.major,
                gpa: row.gpa,
                issueDate: row.issueDate,
                credentialType: row.credentialType,
                institutionName: context.institutionName,
                institutionWallet: context.institutionWallet,
            },
            runtimeConfig.stellar.explorerBaseUrl,
            row.evidenceUrl
                ? {
                      id: row.evidenceUrl,
                      description: `Source document referenced by ${context.institutionName} at issuance.`,
                  }
                : null,
        );
        validateVerifiableCredential(metadata);

        const credentialHash = await generateCredentialHash(metadata);
        const expiresAt = row.expiresAt ? expiryDateToTimestamp(row.expiresAt) : null;

        return { status: 'ready', row, prepared: { row, metadata, credentialHash, expiresAt } };
    } catch (error) {
        captureException(error, { context: 'batchCredentialService_prepareRow', rowNumber: row.rowNumber });
        return {
            status: 'failed',
            row,
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}

async function lookupStudentIds(walletAddresses: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(walletAddresses));
    if (unique.length === 0) {
        return new Map();
    }

    const { data } = await supabase.from('students').select('id, wallet_address').in('wallet_address', unique);

    const map = new Map<string, string>();
    for (const record of data ?? []) {
        if (record.wallet_address) {
            map.set(record.wallet_address, record.id);
        }
    }
    return map;
}

function buildCredentialInsertPayload(
    item: PreparedRow,
    tokenId: string,
    transactionHash: string,
    context: BatchIssuanceContext,
    studentId: string | null,
) {
    return {
        student_id: studentId,
        student_wallet_address: item.row.studentWalletAddress,
        institution_id: context.institutionId,
        issuer_wallet_address: context.institutionWallet,
        token_id: tokenId,
        ipfs_hash: null,
        expires_at: item.expiresAt === null ? null : new Date(item.expiresAt * 1000).toISOString(),
        blockchain_hash: transactionHash,
        metadata: item.metadata,
        metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
        hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
        issued_at: new Date().toISOString(),
        revoked: false,
    };
}

function baseReport(row: CsvCredentialRow): BatchIssuanceRowReport {
    return {
        rowNumber: row.rowNumber,
        studentName: row.studentName,
        studentWalletAddress: row.studentWalletAddress,
        credentialType: row.credentialType,
        degree: row.degree,
        status: 'failed',
        tokenId: null,
        transactionHash: null,
        errorMessage: null,
    };
}

/**
 * Orchestrates a full CSV batch issuance:
 *  1. Validate every row up front (validateCsvRows) — rows that fail never
 *     reach the contract, so a bad row doesn't waste a batch slot.
 *  2. Build and hash a VC document per valid row (bounded concurrency).
 *  3. Chunk the ready rows to MAX_BATCH_CHUNK_SIZE and submit each chunk as
 *     one batchIssueCredentialOnStellar call — one wallet signature covers
 *     a whole chunk.
 *  4. Chunks run sequentially, never in parallel: each needs its own
 *     wallet signature prompt, and concurrent signTransaction calls would
 *     produce competing popups.
 *  5. If a whole chunk call throws (simulation error, cancelled signature,
 *     network failure), stop — don't cascade into more signature prompts —
 *     and report the untried rows as `remainingRows` so the caller can offer
 *     a "retry remaining" action.
 */
export async function issueBatchCredentials(
    rows: CsvCredentialRow[],
    context: BatchIssuanceContext,
    onProgress?: (progress: BatchIssuanceProgress) => void,
): Promise<BatchIssuanceSummary> {
    const reports: BatchIssuanceRowReport[] = [];

    onProgress?.({ phase: 'validating', processedRows: 0, totalRows: rows.length, currentChunk: 0, totalChunks: 0 });

    const validRows: CsvCredentialRow[] = [];
    for (const { row, errors } of validateCsvRows(rows)) {
        if (errors.length > 0) {
            reports.push({ ...baseReport(row), errorMessage: errors.join('; ') });
        } else {
            validRows.push(row);
        }
    }

    let uploadedCount = 0;
    const outcomes = await mapWithConcurrency(validRows, PREPARE_CONCURRENCY, async (row) => {
        const outcome = await prepareRow(row, context);
        uploadedCount += 1;
        onProgress?.({
            phase: 'preparing',
            processedRows: uploadedCount,
            totalRows: validRows.length,
            currentChunk: 0,
            totalChunks: 0,
        });
        return outcome;
    });

    const readyRows: PreparedRow[] = [];
    for (const outcome of outcomes) {
        if (outcome.status === 'ready') {
            readyRows.push(outcome.prepared);
        } else {
            reports.push({ ...baseReport(outcome.row), errorMessage: outcome.errorMessage });
        }
    }

    const chunks = chunkRows(readyRows, MAX_BATCH_CHUNK_SIZE);
    const totalChunks = chunks.length;
    let remainingRows: CsvCredentialRow[] = [];
    let processedSoFar = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        onProgress?.({
            phase: 'signing',
            processedRows: processedSoFar,
            totalRows: readyRows.length,
            currentChunk: chunkIndex + 1,
            totalChunks,
        });

        let outcome: BatchIssueOutcome;
        try {
            outcome = await batchIssueCredentialOnStellar(
                chunk.map((item) => ({
                    studentAddress: item.row.studentWalletAddress,
                    credentialHash: item.credentialHash,
                    expiresAt: item.expiresAt,
                })),
                context.issuer,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            captureException(error, { context: 'batchCredentialService_chunkIssue', chunkIndex });
            for (const item of chunk) {
                reports.push({ ...baseReport(item.row), errorMessage: message });
            }
            remainingRows = chunks.slice(chunkIndex + 1).flatMap((c) => c.map((item) => item.row));
            break;
        }

        onProgress?.({
            phase: 'saving-db',
            processedRows: processedSoFar,
            totalRows: readyRows.length,
            currentChunk: chunkIndex + 1,
            totalChunks,
        });

        const successfulItems = outcome.results
            .map((rowResult) => ({ rowResult, item: chunk[rowResult.index] }))
            .filter((entry): entry is { rowResult: typeof entry.rowResult; item: PreparedRow } =>
                Boolean(entry.item && entry.rowResult.success),
            );

        const studentIds = await lookupStudentIds(successfulItems.map((entry) => entry.item.row.studentWalletAddress));

        const insertPayloads = successfulItems.map(({ rowResult, item }) =>
            buildCredentialInsertPayload(
                item,
                rowResult.tokenId as string,
                outcome.transactionHash,
                context,
                studentIds.get(item.row.studentWalletAddress) ?? null,
            ),
        );

        if (insertPayloads.length > 0) {
            // An upsert: the indexer may already have written status-only rows
            // for these tokens from the chain events (review §3.11c).
            const { error: dbError } = await supabase
                .from('credentials')
                .upsert(insertPayloads, { onConflict: 'token_id' });
            if (dbError) {
                // The credentials are already valid on-chain even though this
                // write failed — keep their report status as success rather
                // than conflating a DB-write failure with an issuance failure.
                // The indexer backfills a status-only row from the
                // `credential_issued` event, but the credential's content is
                // only in this payload (review §3.11c follow-up).
                captureException(dbError, { context: 'batchCredentialService_dbInsert', chunkIndex });
            }

            for (const payload of insertPayloads) {
                fetch('/api/notifications/trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'issued', tokenId: payload.token_id }),
                }).catch((err) => captureException(err, { context: 'batchCredentialService_notify' }));
            }
        }

        for (const rowResult of outcome.results) {
            const item = chunk[rowResult.index];
            if (!item) continue;

            reports.push(
                rowResult.success
                    ? {
                          ...baseReport(item.row),
                          status: 'success',
                          tokenId: rowResult.tokenId,
                          transactionHash: outcome.transactionHash,
                          errorMessage: null,
                      }
                    : {
                          ...baseReport(item.row),
                          transactionHash: outcome.transactionHash,
                          errorMessage: describeBatchRowError(rowResult.errorCode),
                      },
            );
        }

        processedSoFar += chunk.length;
    }

    const succeeded = reports.filter((r) => r.status === 'success').length;

    return {
        total: rows.length,
        succeeded,
        failed: rows.length - succeeded,
        rows: reports,
        remainingRows,
    };
}

function csvEscape(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildBatchIssuanceReportCsv(summary: BatchIssuanceSummary): string {
    const headers = [
        'row_number',
        'student_name',
        'student_wallet_address',
        'credential_type',
        'degree',
        'status',
        'token_id',
        'transaction_hash',
        'error_message',
    ];

    const lines = summary.rows.map((r) =>
        [
            r.rowNumber,
            r.studentName,
            r.studentWalletAddress,
            r.credentialType,
            r.degree,
            r.status,
            r.tokenId,
            r.transactionHash,
            r.errorMessage,
        ]
            .map(csvEscape)
            .join(','),
    );

    return [headers.join(','), ...lines].join('\n');
}

/** Browser-only download trigger — thin wrapper around buildBatchIssuanceReportCsv, not unit-tested (touches document/URL). */
export function downloadBatchIssuanceReport(
    summary: BatchIssuanceSummary,
    filename = `credential-batch-report-${Date.now()}.csv`,
): void {
    const blob = new Blob([buildBatchIssuanceReportCsv(summary)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
