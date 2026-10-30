'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
    parseCredentialCsv,
    validateCsvRows,
    downloadCsvTemplate,
    MAX_BATCH_CHUNK_SIZE,
    type CsvCredentialRow,
    type CsvRowValidation,
} from '@/lib/batchCredentialImport';
import {
    issueBatchCredentials,
    downloadBatchIssuanceReport,
    type BatchIssuanceProgress,
    type BatchIssuanceSummary,
} from '@/lib/batchCredentialService';
import { captureException } from '@/lib/debug';
import { useStellarAccount } from '@/contexts/StellarContext';

interface BatchCredentialImportProps {
    institutionId: string;
    institutionName: string;
    institutionWallet: string;
    account: string | null;
    onSuccess?: () => void;
}

type Phase = 'select' | 'preview' | 'issuing' | 'summary';

const PHASE_LABEL: Record<BatchIssuanceProgress['phase'], string> = {
    validating: 'Validating rows',
    preparing: 'Preparing credentials',
    signing: 'Signing batch transaction',
    'saving-db': 'Saving to database',
};

const MAX_PREVIEW_ROWS = 100;

export function BatchCredentialImport({
    institutionId,
    institutionName,
    institutionWallet,
    account,
    onSuccess,
}: BatchCredentialImportProps) {
    // The signer comes from the wallet context rather than being threaded down
    // as a prop: `account` is still needed for the disabled states below, but
    // signing is the context's business (ACREDIA-STELLAR#3).
    const { signer } = useStellarAccount();
    const [phase, setPhase] = useState<Phase>('select');
    const [fileName, setFileName] = useState<string | null>(null);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [validations, setValidations] = useState<CsvRowValidation[]>([]);
    const [progress, setProgress] = useState<BatchIssuanceProgress | null>(null);
    const [summary, setSummary] = useState<BatchIssuanceSummary | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    const validRows = useMemo(
        () => validations.filter((v) => v.errors.length === 0).map((v) => v.row),
        [validations],
    );
    const invalidCount = validations.length - validRows.length;
    const chunkCount = Math.ceil(validRows.length / MAX_BATCH_CHUNK_SIZE) || 0;

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setFileName(file.name);
        setSummary(null);
        setProgress(null);

        try {
            const text = await file.text();
            const { rows, parseErrors: fileErrors } = parseCredentialCsv(text);
            setParseErrors(fileErrors);

            if (fileErrors.length > 0) {
                setValidations([]);
                setPhase('select');
                toast.error(fileErrors[0]);
                return;
            }

            if (rows.length === 0) {
                setValidations([]);
                setPhase('select');
                toast.error('The CSV file has no data rows.');
                return;
            }

            setValidations(validateCsvRows(rows));
            setPhase('preview');
        } catch (error) {
            captureException(error, { context: 'BatchCredentialImport_parse' });
            toast.error(error instanceof Error ? error.message : 'Failed to read the CSV file.');
        }
    };

    const handleIssue = async (rows: CsvCredentialRow[]) => {
        // Guards on the signer rather than the address: the signer is what
        // issuance actually needs, and it is null in exactly the cases where
        // there is nothing to sign with.
        if (!signer) {
            toast.error('Please connect your wallet first');
            return;
        }
        if (rows.length === 0) {
            return;
        }

        setIsBusy(true);
        setPhase('issuing');
        toast.loading('Issuing credential batch...', { id: 'batch-issue' });

        try {
            const result = await issueBatchCredentials(
                rows,
                { institutionId, institutionName, institutionWallet, issuer: signer },
                setProgress,
            );

            setSummary(result);
            setPhase('summary');

            if (result.failed === 0) {
                toast.success(`All ${result.succeeded} credentials issued successfully!`, {
                    id: 'batch-issue',
                });
            } else {
                toast.warning(
                    `${result.succeeded} of ${result.total} credentials issued. ${result.failed} failed — see the report for details.`,
                    { id: 'batch-issue', duration: 6000 },
                );
            }

            onSuccess?.();
        } catch (error) {
            captureException(error, { context: 'BatchCredentialImport_issue' });
            toast.error(
                (error instanceof Error ? error.message : String(error)) ||
                    'Failed to issue credential batch.',
                { id: 'batch-issue' },
            );
            setPhase('preview');
        } finally {
            setIsBusy(false);
        }
    };

    const handleReset = () => {
        setPhase('select');
        setFileName(null);
        setParseErrors([]);
        setValidations([]);
        setProgress(null);
        setSummary(null);
    };

    return (
        <Card className="p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-foreground">Bulk import credentials</h2>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadCsvTemplate()}>
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV template
                </Button>
            </div>

            {phase === 'select' && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Upload a CSV of students to issue many credentials at once. Rows are batched
                        into groups of up to {MAX_BATCH_CHUNK_SIZE}, each needing a single wallet
                        signature — far fewer signatures than issuing one by one. Every row is
                        validated before anything is uploaded or signed. This path is metadata-only
                        (no attached certificate file per row) — use &quot;Issue credential&quot; for a
                        single credential with an uploaded document.
                    </p>
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center hover:bg-secondary/50">
                        <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                            Click to select a CSV file
                        </span>
                        <span className="text-xs text-muted-foreground">
                            Download the template above for the expected columns
                        </span>
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </label>
                    {parseErrors.length > 0 && (
                        <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-3">
                            {parseErrors.map((error) => (
                                <p key={error} className="text-sm text-destructive">
                                    {error}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {phase === 'preview' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                            {fileName} — {validRows.length} valid, {invalidCount} with errors, across{' '}
                            {chunkCount} signed {chunkCount === 1 ? 'batch' : 'batches'}.
                        </p>
                        <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
                            Choose a different file
                        </Button>
                    </div>

                    <CsvPreviewTable validations={validations} />

                    <Button
                        type="button"
                        className="w-full"
                        disabled={validRows.length === 0 || isBusy || !account}
                        onClick={() => handleIssue(validRows)}
                    >
                        {!account
                            ? 'Connect your wallet to issue'
                            : `Issue ${validRows.length} credential${validRows.length === 1 ? '' : 's'}`}
                    </Button>
                </div>
            )}

            {phase === 'issuing' && <BatchProgressView progress={progress} />}

            {phase === 'summary' && summary && (
                <BatchSummaryView
                    summary={summary}
                    isBusy={isBusy}
                    onDownloadReport={() => downloadBatchIssuanceReport(summary)}
                    onRetryRemaining={
                        summary.remainingRows.length > 0
                            ? () => handleIssue(summary.remainingRows)
                            : undefined
                    }
                    onStartOver={handleReset}
                />
            )}
        </Card>
    );
}

function CsvPreviewTable({ validations }: { validations: CsvRowValidation[] }) {
    const displayed = validations.slice(0, MAX_PREVIEW_ROWS);

    return (
        <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Student</th>
                            <th className="px-3 py-2">Wallet</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Degree</th>
                            <th className="px-3 py-2">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {displayed.map(({ row, errors }) => (
                            <tr key={row.rowNumber} className={errors.length > 0 ? 'bg-destructive/5' : undefined}>
                                <td className="px-3 py-2 text-muted-foreground">{row.rowNumber}</td>
                                <td className="px-3 py-2 font-medium text-foreground">
                                    {row.studentName || '—'}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                    {row.studentWalletAddress
                                        ? `${row.studentWalletAddress.slice(0, 6)}…${row.studentWalletAddress.slice(-4)}`
                                        : '—'}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">{row.credentialType || '—'}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.degree || '—'}</td>
                                <td className="px-3 py-2">
                                    {errors.length === 0 ? (
                                        <span className="inline-flex items-center gap-1 text-success">
                                            <CheckCircle2 className="h-4 w-4" /> Valid
                                        </span>
                                    ) : (
                                        <span
                                            className="inline-flex items-center gap-1 text-destructive"
                                            title={errors.join('; ')}
                                        >
                                            <XCircle className="h-4 w-4" /> {errors[0]}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {validations.length > MAX_PREVIEW_ROWS && (
                <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">
                    Showing first {MAX_PREVIEW_ROWS} of {validations.length} rows. All rows are still
                    validated and issued, not just the ones shown here.
                </p>
            )}
        </div>
    );
}

function BatchProgressView({ progress }: { progress: BatchIssuanceProgress | null }) {
    return (
        <div className="space-y-4 py-10 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
                {progress ? PHASE_LABEL[progress.phase] : 'Starting...'}
            </p>
            {progress && (
                <div className="mx-auto max-w-sm space-y-1">
                    {progress.phase === 'preparing' && (
                        <p className="text-xs text-muted-foreground">
                            {progress.processedRows} / {progress.totalRows} rows prepared
                        </p>
                    )}
                    {progress.totalChunks > 0 && progress.phase !== 'preparing' && (
                        <p className="text-xs text-muted-foreground">
                            Batch {progress.currentChunk} of {progress.totalChunks}
                        </p>
                    )}
                    {progress.phase === 'signing' && (
                        <p className="text-xs text-muted-foreground">
                            Approve the signature request in your wallet for this batch.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function BatchSummaryView({
    summary,
    isBusy,
    onDownloadReport,
    onRetryRemaining,
    onStartOver,
}: {
    summary: BatchIssuanceSummary;
    isBusy: boolean;
    onDownloadReport: () => void;
    onRetryRemaining?: () => void;
    onStartOver: () => void;
}) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-border p-3">
                    <p className="text-2xl font-bold text-foreground">{summary.total}</p>
                    <p className="text-xs text-muted-foreground">Total rows</p>
                </div>
                <div className="rounded-lg border border-success/25 bg-success/8 p-3">
                    <p className="text-2xl font-bold text-success">{summary.succeeded}</p>
                    <p className="text-xs text-muted-foreground">Issued</p>
                </div>
                <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-3">
                    <p className="text-2xl font-bold text-destructive">{summary.failed}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Student</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Token ID / Error</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {summary.rows.map((r) => (
                            <tr key={r.rowNumber}>
                                <td className="px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                                <td className="px-3 py-2 font-medium text-foreground">
                                    {r.studentName || '—'}
                                </td>
                                <td className="px-3 py-2">
                                    {r.status === 'success' ? (
                                        <span className="inline-flex items-center gap-1 text-success">
                                            <CheckCircle2 className="h-4 w-4" /> Success
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-destructive">
                                            <XCircle className="h-4 w-4" /> Failed
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                    {r.status === 'success' ? `Token #${r.tokenId}` : r.errorMessage}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onDownloadReport}>
                    <Download className="mr-2 h-4 w-4" />
                    Download report
                </Button>
                {onRetryRemaining && (
                    <Button type="button" variant="outline" onClick={onRetryRemaining} disabled={isBusy}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retry {summary.remainingRows.length} remaining row
                        {summary.remainingRows.length === 1 ? '' : 's'}
                    </Button>
                )}
                <Button type="button" onClick={onStartOver} disabled={isBusy}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import another file
                </Button>
            </div>
        </div>
    );
}
