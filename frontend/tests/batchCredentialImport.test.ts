import { describe, expect, it } from 'vitest';
import {
    buildCsvTemplateString,
    chunkRows,
    CSV_TEMPLATE_COLUMNS,
    KNOWN_CREDENTIAL_TYPES,
    parseCredentialCsv,
    validateCsvRow,
    validateCsvRows,
    type CsvCredentialRow,
} from '../src/lib/batchCredentialImport';

const validRow: CsvCredentialRow = {
    rowNumber: 1,
    studentName: 'Jane Doe',
    studentWalletAddress: 'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
    studentEmail: 'jane@example.edu',
    credentialType: 'diploma',
    degree: 'Bachelor of Science',
    major: 'Computer Science',
    gpa: '3.8',
    issueDate: '2025-01-01',
    evidenceUrl: 'https://example.edu/evidence.pdf',
};

function toCsvText(header: string[], rows: string[][]): string {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [header.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
}

describe('parseCredentialCsv', () => {
    it('parses a valid CSV into rows with 1-based row numbers', () => {
        const text = toCsvText(
            [...CSV_TEMPLATE_COLUMNS],
            [
                ['Jane Doe', validRow.studentWalletAddress, 'jane@example.edu', 'diploma', 'BSc', 'CS', '3.8', '2025-01-01', '', ''],
                ['John Roe', validRow.studentWalletAddress, '', 'certificate', 'Cert', '', '', '2025-02-01', '', '2099-12-31'],
            ],
        );

        const { rows, parseErrors } = parseCredentialCsv(text);
        expect(parseErrors).toEqual([]);
        expect(rows).toHaveLength(2);
        expect(rows[0].rowNumber).toBe(1);
        expect(rows[1].rowNumber).toBe(2);
        expect(rows[0].studentName).toBe('Jane Doe');
        expect(rows[1].studentEmail).toBeUndefined();
        // expiresAt is optional: empty means the credential never expires.
        expect(rows[0].expiresAt).toBeUndefined();
        expect(rows[1].expiresAt).toBe('2099-12-31');
    });

    it('validates an optional expiry date: future accepted, past or malformed rejected', () => {
        expect(validateCsvRow({ ...validRow, expiresAt: '2099-12-31' }, () => true)).toEqual([]);
        expect(validateCsvRow({ ...validRow, expiresAt: '2000-01-01' }, () => true)).toContain(
            'Expiry date cannot be in the past',
        );
        expect(validateCsvRow({ ...validRow, expiresAt: '31/12/2099' }, () => true)).toContain(
            'Please enter a valid expiry date (YYYY-MM-DD)',
        );
    });

    it('reports missing required columns instead of guessing', () => {
        const text = toCsvText(['studentName', 'degree'], [['Jane Doe', 'BSc']]);
        const { rows, parseErrors } = parseCredentialCsv(text);

        expect(rows).toEqual([]);
        expect(parseErrors.some((e) => e.includes('Missing required column'))).toBe(true);
        expect(parseErrors.some((e) => e.includes('studentWalletAddress'))).toBe(true);
    });

    it('returns no rows for an empty (header-only) file without erroring', () => {
        const text = toCsvText([...CSV_TEMPLATE_COLUMNS], []);
        const { rows, parseErrors } = parseCredentialCsv(text);
        expect(rows).toEqual([]);
        expect(parseErrors).toEqual([]);
    });

    it('lowercases credentialType and trims whitespace on every field', () => {
        const text = toCsvText(
            [...CSV_TEMPLATE_COLUMNS],
            [[' Jane Doe ', ` ${validRow.studentWalletAddress} `, '', ' DIPLOMA ', ' BSc ', '', '', '2025-01-01', '']],
        );
        const { rows } = parseCredentialCsv(text);
        expect(rows[0].studentName).toBe('Jane Doe');
        expect(rows[0].credentialType).toBe('diploma');
        expect(rows[0].degree).toBe('BSc');
    });
});

describe('validateCsvRow', () => {
    it('accepts a fully valid row', () => {
        expect(validateCsvRow(validRow)).toEqual([]);
    });

    it('reuses the shared field validation for name/wallet/degree/date', () => {
        const errors = validateCsvRow({
            ...validRow,
            studentName: '',
            studentWalletAddress: 'not-a-wallet',
            degree: '',
            issueDate: '2999-01-01',
        });

        expect(errors).toContain('Please enter student name');
        expect(errors).toContain('Please enter a valid student wallet address');
        expect(errors).toContain('Please enter degree name');
        expect(errors).toContain('Issue date cannot be in the future');
    });

    it('rejects a credentialType outside the known set', () => {
        const errors = validateCsvRow({ ...validRow, credentialType: 'phd' });
        expect(errors.some((e) => e.includes('Unknown credential type "phd"'))).toBe(true);
        for (const type of KNOWN_CREDENTIAL_TYPES) {
            expect(errors.find((e) => e.includes('Unknown credential type'))).toContain(type);
        }
    });

    it('rejects a malformed evidence URL but allows an empty one', () => {
        expect(validateCsvRow({ ...validRow, evidenceUrl: 'not-a-url' })).toContain(
            'Evidence URL must start with http://, https://, or ipfs://.',
        );
        expect(validateCsvRow({ ...validRow, evidenceUrl: undefined })).toEqual([]);
        expect(validateCsvRow({ ...validRow, evidenceUrl: 'ipfs://bafy123' })).toEqual([]);
    });

    it('rejects an out-of-range GPA', () => {
        expect(validateCsvRow({ ...validRow, gpa: '11' })).toContain('Please enter a valid GPA');
    });
});

describe('validateCsvRows', () => {
    it('pairs each row with its own error list', () => {
        const results = validateCsvRows([validRow, { ...validRow, rowNumber: 2, studentName: '' }]);
        expect(results).toHaveLength(2);
        expect(results[0].errors).toEqual([]);
        expect(results[1].errors).toContain('Please enter student name');
    });
});

describe('chunkRows', () => {
    it('splits rows into exact-size chunks', () => {
        const rows = Array.from({ length: 20 }, (_, i) => i);
        expect(chunkRows(rows, 5)).toEqual([
            [0, 1, 2, 3, 4],
            [5, 6, 7, 8, 9],
            [10, 11, 12, 13, 14],
            [15, 16, 17, 18, 19],
        ]);
    });

    it('leaves a remainder chunk when not evenly divisible', () => {
        const rows = Array.from({ length: 22 }, (_, i) => i);
        const chunks = chunkRows(rows, 5);
        expect(chunks).toHaveLength(5);
        expect(chunks[4]).toEqual([20, 21]);
    });

    it('returns an empty array for no rows', () => {
        expect(chunkRows([], 5)).toEqual([]);
    });

    it('rejects a non-positive chunk size', () => {
        expect(() => chunkRows([1, 2], 0)).toThrow();
    });
});

describe('buildCsvTemplateString', () => {
    it('produces a header matching CSV_TEMPLATE_COLUMNS in order plus one example row', () => {
        const template = buildCsvTemplateString();
        const [header, ...rest] = template.trim().split('\n');
        expect(header).toBe(CSV_TEMPLATE_COLUMNS.join(','));
        expect(rest).toHaveLength(1);
    });

    it('produces an example row that itself parses and validates cleanly', () => {
        const { rows, parseErrors } = parseCredentialCsv(buildCsvTemplateString());
        expect(parseErrors).toEqual([]);
        expect(rows).toHaveLength(1);
        expect(validateCsvRow(rows[0])).toEqual([]);
    });
});
