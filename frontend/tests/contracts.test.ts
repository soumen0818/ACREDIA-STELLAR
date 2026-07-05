import { describe, expect, it } from 'vitest';
import { normalizeTokenId } from '../src/lib/contracts';

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
