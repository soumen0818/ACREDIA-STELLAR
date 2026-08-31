import Papa from 'papaparse';
import { isValidAddress } from './contracts';

/**
 * CSV parsing and validation for institution student rosters (Issue #241).
 *
 * Deliberately mirrors `batchCredentialImport.ts` — same header-driven parse,
 * same 1-based row numbering, same "file-level errors are distinct from
 * per-row errors" split — so an institution that has used the credential batch
 * import already knows how this behaves.
 */

export const STUDENT_CSV_TEMPLATE_COLUMNS = [
    'name',
    'email',
    'studentRef',
    'walletAddress',
] as const;

const REQUIRED_STUDENT_CSV_COLUMNS: Array<(typeof STUDENT_CSV_TEMPLATE_COLUMNS)[number]> = [
    'name',
    'email',
];

/** Bulk import is a database write, not an on-chain batch, so the cap is ours. */
export const MAX_STUDENT_IMPORT_ROWS = 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CsvStudentRow {
    /** 1-based data row number (excludes the header row), shown to the user. */
    rowNumber: number;
    name: string;
    email: string;
    studentRef?: string;
    walletAddress?: string;
}

export interface StudentCsvParseResult {
    rows: CsvStudentRow[];
    /** File-level problems (missing columns, malformed CSV, row cap). */
    parseErrors: string[];
}

function cell(record: Record<string, string>, key: string): string {
    return (record[key] ?? '').trim();
}

export function parseStudentCsv(fileText: string): StudentCsvParseResult {
    const parsed = Papa.parse<Record<string, string>>(fileText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });

    const parseErrors: string[] = parsed.errors.map(
        (err) => `Row ${(err.row ?? 0) + 2}: ${err.message}`,
    );

    const fields = parsed.meta.fields ?? [];
    const missingColumns = REQUIRED_STUDENT_CSV_COLUMNS.filter((col) => !fields.includes(col));
    if (missingColumns.length > 0) {
        parseErrors.push(
            `Missing required column(s): ${missingColumns.join(', ')}. Download the CSV template for the expected format.`,
        );
        return { rows: [], parseErrors };
    }

    const rows: CsvStudentRow[] = (parsed.data ?? []).map((record, index) => ({
        rowNumber: index + 1,
        name: cell(record, 'name'),
        email: cell(record, 'email'),
        studentRef: cell(record, 'studentRef') || undefined,
        walletAddress: cell(record, 'walletAddress') || undefined,
    }));

    if (rows.length > MAX_STUDENT_IMPORT_ROWS) {
        parseErrors.push(
            `This file has ${rows.length} rows; the limit is ${MAX_STUDENT_IMPORT_ROWS} per import. Split it into smaller files.`,
        );
    }

    return { rows, parseErrors };
}

/**
 * Validates one roster row.
 *
 * A wallet address is optional by design: a student record may exist before
 * that student has a Stellar wallet, and issuance is never blocked on it.
 * When one *is* supplied it must be a real address, since a typo here would
 * mint a credential to an address nobody controls.
 */
export function validateStudentRow(
    row: CsvStudentRow,
    isWalletAddressValid = isValidAddress,
): string[] {
    const errors: string[] = [];

    if (!row.name) {
        errors.push('Name is required.');
    } else if (row.name.length > 200) {
        errors.push('Name must be 200 characters or fewer.');
    }

    if (!row.email) {
        errors.push('Email is required.');
    } else if (!EMAIL_PATTERN.test(row.email)) {
        errors.push(`"${row.email}" is not a valid email address.`);
    }

    if (row.studentRef && row.studentRef.length > 64) {
        errors.push('Student ID must be 64 characters or fewer.');
    }

    if (row.walletAddress && !isWalletAddressValid(row.walletAddress)) {
        errors.push(`"${row.walletAddress}" is not a valid Stellar wallet address.`);
    }

    return errors;
}

export interface StudentCsvRowValidation {
    row: CsvStudentRow;
    errors: string[];
}

export function validateStudentRows(
    rows: CsvStudentRow[],
    isWalletAddressValid = isValidAddress,
): StudentCsvRowValidation[] {
    const validations = rows.map((row) => ({
        row,
        errors: validateStudentRow(row, isWalletAddressValid),
    }));

    // Duplicates inside one file would otherwise fail one-by-one at insert
    // time with an opaque constraint error. Reporting them per-row up front is
    // what makes a 500-row import fixable in one pass.
    flagDuplicates(
        validations,
        (row) => row.email.toLowerCase(),
        (value) => `Duplicate email "${value}" appears more than once in this file.`,
    );
    flagDuplicates(
        validations,
        (row) => row.studentRef?.toLowerCase(),
        (value) => `Duplicate student ID "${value}" appears more than once in this file.`,
    );
    flagDuplicates(
        validations,
        (row) => row.walletAddress,
        (value) => `Duplicate wallet address "${value}" appears more than once in this file.`,
    );

    return validations;
}

function flagDuplicates(
    validations: StudentCsvRowValidation[],
    key: (row: CsvStudentRow) => string | undefined,
    message: (value: string) => string,
): void {
    const seen = new Map<string, number>();

    for (const validation of validations) {
        const value = key(validation.row);
        if (!value) continue;
        seen.set(value, (seen.get(value) ?? 0) + 1);
    }

    for (const validation of validations) {
        const value = key(validation.row);
        if (value && (seen.get(value) ?? 0) > 1) {
            validation.errors.push(message(value));
        }
    }
}

export function buildStudentCsvTemplateString(): string {
    const header = STUDENT_CSV_TEMPLATE_COLUMNS.join(',');
    const example = [
        'Jane Doe',
        'jane@example.edu',
        'ENR-2026-0142',
        'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
    ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(',');
    return `${header}\n${example}\n`;
}

/** Browser-only download trigger — thin wrapper, not unit-tested (touches document/URL). */
export function downloadStudentCsvTemplate(filename = 'student-roster-template.csv'): void {
    const blob = new Blob([buildStudentCsvTemplateString()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
