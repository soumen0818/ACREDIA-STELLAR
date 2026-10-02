import { describe, expect, it } from 'vitest';
import { KEEPER_COVERAGE_WINDOW_DAYS, KEEPER_PAGE_SIZE, planCredentialSweep } from '../src/lib/ttlKeeper';

describe('TTL keeper coverage plan', () => {
    it('rotates through all token IDs, including revoked and missing index rows', () => {
        expect(planCredentialSweep(5, 4, 3)).toEqual({
            tokenIds: ['4', '5', '1'], nextTokenId: 2, capacityExceeded: false,
        });
        expect(planCredentialSweep(5, 2, 3).tokenIds).toEqual(['2', '3', '4']);
    });

    it('reports capacity beyond the buffered sweep window', () => {
        expect(planCredentialSweep(KEEPER_PAGE_SIZE * KEEPER_COVERAGE_WINDOW_DAYS, 1).capacityExceeded).toBe(false);
        expect(planCredentialSweep(KEEPER_PAGE_SIZE * KEEPER_COVERAGE_WINDOW_DAYS + 1, 1).capacityExceeded).toBe(true);
    });

    it('handles an empty chain and rejects unsafe counts', () => {
        expect(planCredentialSweep(0, 1).tokenIds).toEqual([]);
        expect(() => planCredentialSweep(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow();
    });
});
