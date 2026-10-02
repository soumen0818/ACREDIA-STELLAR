/**
 * A purge is expected nightly. Two missed nights is unambiguous: a single
 * skipped run, clock skew, or slow deploy window will not trip it.
 */
export const STALE_AFTER_HOURS = 48;

export function hoursSince(timestamp: string | null | undefined, now = Date.now()): number | null {
    if (!timestamp) return null;
    const parsed = new Date(timestamp).getTime();
    if (Number.isNaN(parsed)) return null;
    return (now - parsed) / 3_600_000;
}

/** A never-run purge is stale as well. */
export function isRetentionStale(
    lastSuccessAt: string | null | undefined,
    now = Date.now(),
): boolean {
    const age = hoursSince(lastSuccessAt, now);
    return age === null || age > STALE_AFTER_HOURS;
}
