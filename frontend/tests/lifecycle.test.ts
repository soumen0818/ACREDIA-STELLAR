import { describe, it, expect } from 'vitest';
import { getNextStatus, validatePayload } from '../src/lib/lifecycle';

describe('Business Logic: State Transitions & Validation', () => {
    describe('getNextStatus - State Machine', () => {
        it('allows valid state transitions', () => {
            expect(getNextStatus('Draft', 'SUBMIT')).toBe('Pending_Issuance');
            expect(getNextStatus('Pending_Issuance', 'CONFIRM')).toBe('Issued');
            expect(getNextStatus('Issued', 'REVOKE')).toBe('Revoked');
        });

        it('rejects invalid transitions (returns null)', () => {
            expect(getNextStatus('Draft', 'CONFIRM')).toBeNull();
            expect(getNextStatus('Issued', 'SUBMIT')).toBeNull();
            expect(getNextStatus('Revoked', 'CONFIRM')).toBeNull();
        });

        it('returns null for explicitly null state transitions like DELETE from Draft', () => {
            expect(getNextStatus('Draft', 'DELETE')).toBeNull();
        });
    });

    describe('validatePayload - Validation Logic', () => {
        it('returns valid for proper payload', () => {
            const payload = {
                studentWallet: 'GAMHNZ6QDGUP5ONSGJOP5BLYLZFISEA4JZWUGXNHPHIAPEYNZBKTTLV6',
            };
            const result = validatePayload(payload);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('fails when payload is missing wallet', () => {
            const payload = { someOtherField: 'value' };
            const result = validatePayload(payload);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Student wallet is required');
        });

        it('fails on empty payload or null', () => {
            const result1 = validatePayload(null);
            expect(result1.valid).toBe(false);
            expect(result1.error).toBe('Payload cannot be null');

            const result2 = validatePayload({});
            expect(result2.valid).toBe(false);
        });

        it('fails on malformed data (short wallet config)', () => {
            const payload = { studentWallet: 'GAMH' };
            const result = validatePayload(payload);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid wallet address');
        });
    });
});
