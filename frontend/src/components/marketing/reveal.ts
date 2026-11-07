import type { CSSProperties } from 'react';

/**
 * Staggers `.reveal` items that scroll into view together, such as a row of
 * cards: step 0 starts fading first, each later step a little further into
 * its entry (see `.reveal` in globals.css).
 */
export function revealDelay(step: number): CSSProperties {
    return { '--reveal-delay': `${step * 32}px` } as CSSProperties;
}
