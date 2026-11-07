'use client';

import { MotionConfig } from 'framer-motion';

/**
 * Root Providers Component
 *
 * MotionConfig honors the user's reduced-motion preference so entrance
 * animations never fight accessibility settings.
 *
 * The session and wallet providers are mounted only where they are used:
 * `app/(console)/layout.tsx` and `app/claim/layout.tsx`. Mounted here, they
 * put the wallet stack and the Supabase client on every page (review §4.1).
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
