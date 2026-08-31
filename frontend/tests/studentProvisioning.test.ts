import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import {
    buildStudentCsvTemplateString,
    MAX_STUDENT_IMPORT_ROWS,
    parseStudentCsv,
    validateStudentRow,
    validateStudentRows,
    type CsvStudentRow,
} from '../src/lib/studentRosterImport';
import {
    buildClaimMessage,
    normalizeSignedMessage,
    verifyWalletSignature,
} from '../src/lib/walletOwnership';

function row(overrides: Partial<CsvStudentRow> = {}): CsvStudentRow {
    return {
        rowNumber: 1,
        name: 'Jane Doe',
        email: 'jane@example.edu',
        ...overrides,
    };
}

describe('student roster CSV parsing', () => {
    it('parses a well-formed roster', () => {
        const csv = [
            'name,email,studentRef,walletAddress',
            'Jane Doe,jane@example.edu,ENR-1,',
            'John Roe,john@example.edu,,',
        ].join('\n');

        const { rows, parseErrors } = parseStudentCsv(csv);

        expect(parseErrors).toEqual([]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rowNumber: 1, name: 'Jane Doe', studentRef: 'ENR-1' });
        // Empty optional cells become undefined, not empty strings.
        expect(rows[1].studentRef).toBeUndefined();
    });

    it('reports missing required columns as a file-level error', () => {
        const { rows, parseErrors } = parseStudentCsv('name,studentRef\nJane Doe,ENR-1');

        expect(rows).toEqual([]);
        expect(parseErrors.join(' ')).toContain('email');
    });

    it('rejects a file over the import cap', () => {
        const body = Array.from(
            { length: MAX_STUDENT_IMPORT_ROWS + 1 },
            (_, index) => `Student ${index},student${index}@example.edu,,`,
        ).join('\n');

        const { parseErrors } = parseStudentCsv(`name,email,studentRef,walletAddress\n${body}`);

        expect(parseErrors.join(' ')).toContain(String(MAX_STUDENT_IMPORT_ROWS));
    });

    it('round-trips its own template', () => {
        const { rows, parseErrors } = parseStudentCsv(buildStudentCsvTemplateString());

        expect(parseErrors).toEqual([]);
        expect(rows).toHaveLength(1);
        expect(validateStudentRow(rows[0])).toEqual([]);
    });
});

describe('student row validation', () => {
    it('accepts a row with only the required fields', () => {
        expect(validateStudentRow(row())).toEqual([]);
    });

    it('requires a name and a valid email', () => {
        expect(validateStudentRow(row({ name: '' })).join(' ')).toContain('Name is required');
        expect(validateStudentRow(row({ email: '' })).join(' ')).toContain('Email is required');
        expect(validateStudentRow(row({ email: 'not-an-email' })).join(' ')).toContain(
            'not a valid email',
        );
    });

    it('treats the wallet as optional, so issuance is never blocked on it', () => {
        expect(validateStudentRow(row({ walletAddress: undefined }))).toEqual([]);
    });

    it('rejects a malformed wallet when one is supplied', () => {
        const errors = validateStudentRow(row({ walletAddress: 'NOT-A-WALLET' }));
        expect(errors.join(' ')).toContain('not a valid Stellar wallet address');
    });

    it('accepts a real Stellar address', () => {
        const address = Keypair.random().publicKey();
        expect(validateStudentRow(row({ walletAddress: address }))).toEqual([]);
    });

    it('flags duplicates within one file, on every unique column', () => {
        const validations = validateStudentRows([
            row({ rowNumber: 1, email: 'dup@example.edu', studentRef: 'A' }),
            row({ rowNumber: 2, email: 'DUP@example.edu', studentRef: 'B' }),
            row({ rowNumber: 3, email: 'other@example.edu', studentRef: 'A' }),
        ]);

        // Email comparison is case-insensitive, matching how the row is stored.
        expect(validations[0].errors.join(' ')).toContain('Duplicate email');
        expect(validations[1].errors.join(' ')).toContain('Duplicate email');
        expect(validations[2].errors.join(' ')).toContain('Duplicate student ID');
    });

    it('does not flag a unique roster as duplicated', () => {
        const validations = validateStudentRows([
            row({ rowNumber: 1, email: 'a@example.edu' }),
            row({ rowNumber: 2, email: 'b@example.edu' }),
        ]);

        expect(validations.every((entry) => entry.errors.length === 0)).toBe(true);
    });
});

describe('wallet ownership verification', () => {
    const keypair = Keypair.random();
    const wallet = keypair.publicKey();
    const nonce = 'a'.repeat(64);

    function sign(message: string, signer = keypair): string {
        return signer.sign(Buffer.from(message, 'utf8')).toString('base64');
    }

    it('accepts a genuine signature over the exact challenge', () => {
        const message = buildClaimMessage(wallet, nonce);

        expect(verifyWalletSignature(wallet, message, sign(message))).toBe(true);
    });

    it('binds the signature to the wallet, so it cannot be replayed for another', () => {
        const other = Keypair.random();
        const message = buildClaimMessage(wallet, nonce);
        const signature = sign(message);

        // Same signature, different claimed address.
        expect(verifyWalletSignature(other.publicKey(), message, signature)).toBe(false);
    });

    it('rejects a signature made by a different key', () => {
        const message = buildClaimMessage(wallet, nonce);
        const impostor = Keypair.random();

        expect(verifyWalletSignature(wallet, message, sign(message, impostor))).toBe(false);
    });

    it('rejects a signature over a different challenge', () => {
        const signature = sign(buildClaimMessage(wallet, nonce));
        const differentNonce = buildClaimMessage(wallet, 'b'.repeat(64));

        expect(verifyWalletSignature(wallet, differentNonce, signature)).toBe(false);
    });

    it('fails closed on malformed input rather than throwing', () => {
        const message = buildClaimMessage(wallet, nonce);

        expect(verifyWalletSignature('not-an-address', message, sign(message))).toBe(false);
        expect(verifyWalletSignature(wallet, message, 'not-base64!!')).toBe(false);
        expect(verifyWalletSignature(wallet, message, '')).toBe(false);
        expect(verifyWalletSignature('', message, sign(message))).toBe(false);
        // Valid base64, wrong length for an ed25519 signature.
        expect(verifyWalletSignature(wallet, message, Buffer.from('short').toString('base64'))).toBe(
            false,
        );
    });

    it('embeds the wallet and challenge in the signed text', () => {
        const message = buildClaimMessage(wallet, nonce);

        expect(message).toContain(wallet);
        expect(message).toContain(nonce);
    });

    it('normalizes both Freighter response shapes to base64', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);

        expect(normalizeSignedMessage('YWJj')).toBe('YWJj');
        expect(normalizeSignedMessage(bytes)).toBe(Buffer.from(bytes).toString('base64'));
        expect(normalizeSignedMessage(null)).toBeNull();
    });
});

describe('student provisioning migration', () => {
    const migration = readFileSync(
        join(
            process.cwd(),
            'supabase',
            'migrations',
            '20260810000000_student_provisioning_and_claim.sql',
        ),
        'utf8',
    );

    it('records the Issue #243 access-model decision and recovery answer', () => {
        expect(migration).toContain('ACCESS MODEL DECISION');
        expect(migration).toContain('Option C');
        expect(migration).toContain('LOST-WALLET RECOVERY');
    });

    it('scopes students to an owning institution', () => {
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS institution_id');
        expect(migration).toContain('CREATE POLICY "Institutions can view own students"');
        expect(migration).toContain('institution_id IN (SELECT public.user_institution_ids())');
    });

    it('restricts roster writes to roles that may write', () => {
        expect(migration).toContain('CREATE POLICY "Institutions can insert own students"');
        expect(migration).toContain('CREATE POLICY "Institutions can update own students"');
        expect(migration).toContain(
            'institution_id IN (SELECT public.user_issuer_institution_ids())',
        );
    });

    it('never allows a student row to be deleted, so credentials keep their subject', () => {
        expect(migration).not.toMatch(/CREATE POLICY[^;]*students FOR DELETE/i);
    });

    it('makes claim nonces single-use, expiring, and wallet-bound', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.wallet_claim_nonces');
        expect(migration).toContain('wallet_address TEXT NOT NULL');
        expect(migration).toContain('nonce          TEXT NOT NULL UNIQUE');
        expect(migration).toContain('expires_at     TIMESTAMP WITH TIME ZONE NOT NULL');
        expect(migration).toContain('consumed_at    TIMESTAMP WITH TIME ZONE');
        expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    });

    it('audits student provisioning and claim actions', () => {
        for (const action of [
            'create_student',
            'update_student',
            'deactivate_student',
            'bulk_import_students',
            'generate_student_invite',
            'claim_wallet_attempt',
            'claim_wallet_success',
        ]) {
            expect(migration).toContain(`'${action}'`);
        }
    });

    it('keeps a student id unique per institution rather than globally', () => {
        expect(migration).toContain('idx_students_institution_ref');
        expect(migration).toContain('ON public.students (institution_id, student_ref)');
    });
});
