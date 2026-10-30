import Papa from 'papaparse';
import { CONTRACT_MAX_BATCH_SIZE, isValidAddress } from './contracts';
import { parseIssueDate, validateCommonCredentialFields } from './credentialValidation';

export const CSV_TEMPLATE_COLUMNS = [
    'studentName',
    'studentWalletAddress',
    'studentEmail',
    'credentialType',
    'degree',
    'major',
    'gpa',
    'issueDate',
    'evidenceUrl',
    'expiresAt',
] as const;

const REQUIRED_CSV_COLUMNS: Array<(typeof CSV_TEMPLATE_COLUMNS)[number]> = [
    'studentName',
    'studentWalletAddress',
    'credentialType',
    'degree',
    'issueDate',
];

// Matches ACHIEVEMENT_TYPE_BY_CREDENTIAL_TYPE in verifiableCredential.ts and
// the <SelectItem> options in CredentialUploadFormSections.tsx.
export const KNOWN_CREDENTIAL_TYPES = [
    'diploma',
    'degree',
    'transcript',
    'certificate',
    'achievement',
] as const;

const EVIDENCE_URL_PATTERN = /^(https?:\/\/|ipfs:\/\/)/i;

export interface CsvCredentialRow {
    /** 1-based data row number (excludes the header row), shown to the user. */
    rowNumber: number;
    studentName: string;
    studentWalletAddress: string;
    studentEmail?: string;
    credentialType: string;
    degree: string;
    major?: string;
    gpa?: string;
    issueDate: string;
    evidenceUrl?: string;
    /** Optional `YYYY-MM-DD`; the credential is valid through this date (UTC). */
    expiresAt?: string;
}

export interface CsvParseResult {
    rows: CsvCredentialRow[];
    /** File-level problems (missing columns, malformed CSV) — distinct from per-row validation errors. */
    parseErrors: string[];
}

function cell(record: Record<string, string>, key: string): string {
    return (record[key] ?? '').trim();
}

export function parseCredentialCsv(fileText: string): CsvParseResult {
    const parsed = Papa.parse<Record<string, string>>(fileText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });

    const parseErrors: string[] = parsed.errors.map(
        (err) => `Row ${(err.row ?? 0) + 2}: ${err.message}`,
    );

    const fields = parsed.meta.fields ?? [];
    const missingColumns = REQUIRED_CSV_COLUMNS.filter((col) => !fields.includes(col));
    if (missingColumns.length > 0) {
        parseErrors.push(
            `Missing required column(s): ${missingColumns.join(', ')}. Download the CSV template for the expected format.`,
        );
        return { rows: [], parseErrors };
    }

    const rows: CsvCredentialRow[] = (parsed.data ?? []).map((record, index) => ({
        rowNumber: index + 1,
        studentName: cell(record, 'studentName'),
        studentWalletAddress: cell(record, 'studentWalletAddress'),
        studentEmail: cell(record, 'studentEmail') || undefined,
        credentialType: cell(record, 'credentialType').toLowerCase(),
        degree: cell(record, 'degree'),
        major: cell(record, 'major') || undefined,
        gpa: cell(record, 'gpa') || undefined,
        issueDate: cell(record, 'issueDate'),
        evidenceUrl: cell(record, 'evidenceUrl') || undefined,
        expiresAt: cell(record, 'expiresAt') || undefined,
    }));

    return { rows, parseErrors };
}

/**
 * Validates one CSV row. Reuses the same field checks the single-issuance
 * form uses (validateCommonCredentialFields) plus two checks that only make
 * sense for free-text CSV input: credentialType must be one of the app's
 * known types (the single-issuance form gets this for free from a <select>),
 * and evidenceUrl (this batch path's file-upload substitute — see module
 * docs in batchCredentialService.ts) must look like a URL/IPFS URI.
 */
export function validateCsvRow(
    row: CsvCredentialRow,
    isWalletAddressValid = isValidAddress,
): string[] {
    const errors = validateCommonCredentialFields(
        {
            studentName: row.studentName,
            studentWallet: row.studentWalletAddress,
            credentialType: row.credentialType,
            degree: row.degree,
            gpa: row.gpa,
            issueDate: row.issueDate,
            expiresAt: row.expiresAt,
        },
        isWalletAddressValid,
    );

    if (row.credentialType && !(KNOWN_CREDENTIAL_TYPES as readonly string[]).includes(row.credentialType)) {
        errors.push(
            `Unknown credential type "${row.credentialType}". Must be one of: ${KNOWN_CREDENTIAL_TYPES.join(', ')}.`,
        );
    }

    if (row.evidenceUrl && !EVIDENCE_URL_PATTERN.test(row.evidenceUrl)) {
        errors.push('Evidence URL must start with http://, https://, or ipfs://.');
    }

    return errors;
}

export interface CsvRowValidation {
    row: CsvCredentialRow;
    errors: string[];
}

export function validateCsvRows(
    rows: CsvCredentialRow[],
    isWalletAddressValid = isValidAddress,
): CsvRowValidation[] {
    return rows.map((row) => ({ row, errors: validateCsvRow(row, isWalletAddressValid) }));
}

// Kept equal to the contract's real enforced MAX_BATCH_SIZE (see
// CONTRACT_MAX_BATCH_SIZE in contracts.ts) so a chunk never gets rejected
// on-chain for being oversized.
export const MAX_BATCH_CHUNK_SIZE = CONTRACT_MAX_BATCH_SIZE;

export function chunkRows<T>(rows: T[], chunkSize: number = MAX_BATCH_CHUNK_SIZE): T[][] {
    if (chunkSize <= 0) {
        throw new Error('chunkSize must be greater than 0');
    }

    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
        chunks.push(rows.slice(i, i + chunkSize));
    }
    return chunks;
}

export function buildCsvTemplateString(): string {
    const header = CSV_TEMPLATE_COLUMNS.join(',');
    const example = [
        'Jane Doe',
        'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
        'jane@example.edu',
        'diploma',
        'Bachelor of Science',
        'Computer Science',
        '3.8',
        '2026-05-15',
        'https://example.edu/evidence/jane-doe.pdf',
        // expiresAt: leave empty for a credential that never expires.
        '',
    ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(',');
    return `${header}\n${example}\n`;
}

/** Browser-only download trigger — thin wrapper around buildCsvTemplateString, not unit-tested (touches document/URL). */
export function downloadCsvTemplate(filename = 'credential-batch-template.csv'): void {
    const blob = new Blob([buildCsvTemplateString()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

// Re-exported so callers that only need date parsing don't have to import
// from credentialValidation.ts directly.
export { parseIssueDate };
