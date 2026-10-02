/** One daily slice of the sequential on-chain token-id space. */
export const KEEPER_PAGE_SIZE = 50;
// Leave roughly three months of margin before the contract's ~six-month
// extension threshold; missed daily runs must not consume the whole window.
export const KEEPER_COVERAGE_WINDOW_DAYS = 90;

export function planCredentialSweep(total: number, nextTokenId: number, pageSize = KEEPER_PAGE_SIZE) {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(nextTokenId) || !Number.isSafeInteger(pageSize) || pageSize < 1) {
        throw new Error('Invalid keeper sweep cursor or credential count');
    }
    if (total === 0) return { tokenIds: [] as string[], nextTokenId: 1, capacityExceeded: false };
    const start = Math.min(Math.max(nextTokenId, 1), total);
    const tokenIds = Array.from({ length: Math.min(total, pageSize) }, (_, offset) =>
        String(((start - 1 + offset) % total) + 1),
    );
    return {
        tokenIds,
        nextTokenId: ((start - 1 + tokenIds.length) % total) + 1,
        capacityExceeded: total > pageSize * KEEPER_COVERAGE_WINDOW_DAYS,
    };
}
