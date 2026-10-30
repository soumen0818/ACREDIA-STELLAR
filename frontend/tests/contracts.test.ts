import { describe, expect, it } from 'vitest';
import { nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import {
    batchCredentialInputToScVal,
    describeBatchRowError,
    expiresAtToScVal,
    getSorobanTransactionResult,
    normalizeTokenId,
} from '../src/lib/contracts';

describe('Soroban credential token IDs', () => {
    it('normalizes u64 return values to database-safe token ID strings', () => {
        expect(normalizeTokenId(1)).toBe('1');
        expect(normalizeTokenId(BigInt(42))).toBe('42');
        expect(normalizeTokenId('123')).toBe('123');
    });

    it('rejects missing or non-numeric return values instead of falling back to a transaction hash', () => {
        expect(() => normalizeTokenId(null)).toThrow(/valid token ID/);
        expect(() => normalizeTokenId(undefined)).toThrow(/valid token ID/);
        expect(() => normalizeTokenId('pending')).toThrow(/valid token ID/);
        expect(() => normalizeTokenId('abcdef')).toThrow(/valid token ID/);
    });
});

describe('describeBatchRowError', () => {
    it('maps the known CredentialAlreadyExists code (3) to a specific message', () => {
        expect(describeBatchRowError(3)).toMatch(/already exists/i);
    });

    it('falls back to a generic message for an unrecognized code', () => {
        expect(describeBatchRowError(99)).toBe('Contract error 99');
    });

    it('reports "Unknown error" for a null code', () => {
        expect(describeBatchRowError(null)).toBe('Unknown error');
    });
});

describe('batchCredentialInputToScVal', () => {
    it('encodes struct fields as symbol keys sorted ascending by Rust field name', () => {
        // Soroban's derive_struct macro decodes #[contracttype] structs via a
        // binary_search_by_key over field-name symbols, so the ScMap keys
        // MUST be symbols (not strings) in ascending alphabetical order —
        // credential_hash < expires_at < student — or the contract call traps
        // on the host. This locks that shape down directly against the XDR.
        const scVal = batchCredentialInputToScVal({
            studentAddress: 'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
            credentialHash: 'a'.repeat(64),
            expiresAt: null,
        });

        expect(scVal.type).toBe('scvMap');
        const entries = scVal.type === 'scvMap' ? (scVal.map ?? []) : [];
        const keys = entries.map((entry) => {
            const key = entry.key;
            expect(key.type).toBe('scvSymbol');
            return key.type === 'scvSymbol' ? key.sym.toString() : '';
        });

        expect(keys).toEqual(['credential_hash', 'expires_at', 'student']);
        expect(keys).toEqual([...keys].sort());
    });

    it('encodes expiry as the contract Option<u64>: void for none, u64 seconds for some', () => {
        expect(expiresAtToScVal(null).type).toBe('scvVoid');
        const some = expiresAtToScVal(1_900_000_000);
        expect(some.type).toBe('scvU64');
        expect(scValToNative(some)).toBe(BigInt(1_900_000_000));

        const withExpiry = batchCredentialInputToScVal({
            studentAddress: 'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
            credentialHash: 'a'.repeat(64),
            expiresAt: 1_900_000_000,
        });
        const entries = withExpiry.type === 'scvMap' ? (withExpiry.map ?? []) : [];
        const expiry = entries.find(
            (entry) => entry.key.type === 'scvSymbol' && entry.key.sym.toString() === 'expires_at',
        );
        expect(expiry && scValToNative(expiry.val)).toBe(BigInt(1_900_000_000));
    });
});

describe('getSorobanTransactionResult', () => {
    it('extracts retval from canonical sim.result.retval (Soroban SDK 17 shape)', () => {
        const val = nativeToScVal(42, { type: 'u64' });
        expect(getSorobanTransactionResult({ result: { retval: val } })).toBe(BigInt(42));
    });

    it('extracts retval from nested sim.result.result.retval', () => {
        const val = nativeToScVal('hello', { type: 'string' });
        expect(getSorobanTransactionResult({ result: { result: { retval: val } } })).toBe('hello');
    });

    it('extracts retval from flat sim.retval fallback', () => {
        const val = nativeToScVal(true, { type: 'bool' });
        expect(getSorobanTransactionResult({ retval: val })).toBe(true);
    });

    it('extracts retval from sim.result.xdr.retval', () => {
        const val = nativeToScVal(123, { type: 'i32' });
        expect(getSorobanTransactionResult({ result: { xdr: { retval: val } } })).toBe(123);
    });

    it('decodes base64-encoded ScVal string return values', () => {
        const val = nativeToScVal('verified', { type: 'string' });
        const b64 = val.toXDR('base64');
        expect(getSorobanTransactionResult({ result: { retval: b64 } })).toBe('verified');
    });

    it('returns null safely for missing, null, or undefined responses', () => {
        expect(getSorobanTransactionResult(null)).toBeNull();
        expect(getSorobanTransactionResult(undefined)).toBeNull();
        expect(getSorobanTransactionResult({})).toBeNull();
        expect(getSorobanTransactionResult({ result: {} })).toBeNull();
        expect(getSorobanTransactionResult({ result: { retval: null } })).toBeNull();
    });

    it('handles malformed base64 strings gracefully without throwing', () => {
        expect(getSorobanTransactionResult({ result: { retval: 'not-valid-base64!' } })).toBeNull();
    });
});
