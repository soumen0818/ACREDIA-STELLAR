'use client';

import { useCallback, useEffect, useState } from 'react';
import { safeGetSession } from '@/lib/supabase';
import { captureException } from '@/lib/debug';
import type { ContinuityAssessment } from '@/lib/institutionContinuity';
import type { InstitutionMemberView } from '@/lib/institutionMembers';

/** Fired after any change to the team, so every view of it refreshes. */
export const TEAM_CHANGED_EVENT = 'acredia:team-changed';

export function notifyTeamChanged(): void {
    window.dispatchEvent(new Event(TEAM_CHANGED_EVENT));
}

/** An API failure that keeps the server's machine-readable `code`. */
export class TeamApiError extends Error {
    constructor(
        message: string,
        readonly code: string | null,
        readonly status: number,
    ) {
        super(message);
        this.name = 'TeamApiError';
    }
}

/** Calls a team-management route with the caller's session attached. */
export async function teamFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const {
        data: { session },
    } = await safeGetSession();

    if (!session?.access_token) {
        throw new TeamApiError('Your session expired. Please sign in again.', null, 401);
    }

    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    if (options?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.success) {
        throw new TeamApiError(
            payload?.error || 'Request failed',
            payload?.code ?? null,
            response.status,
        );
    }

    return payload as T;
}

export interface InstitutionTeamState {
    loading: boolean;
    error: string | null;
    members: InstitutionMemberView[];
    continuity: ContinuityAssessment | null;
    canManage: boolean;
    refresh: () => Promise<void>;
}

/**
 * The caller's institution team and its continuity status (Issue #307).
 * Refreshes whenever {@link notifyTeamChanged} fires.
 */
export function useInstitutionTeam(): InstitutionTeamState {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [members, setMembers] = useState<InstitutionMemberView[]>([]);
    const [continuity, setContinuity] = useState<ContinuityAssessment | null>(null);
    const [canManage, setCanManage] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const payload = await teamFetch<{
                members: InstitutionMemberView[];
                continuity: ContinuityAssessment;
                canManage: boolean;
            }>('/api/institution/members');
            setMembers(payload.members);
            setContinuity(payload.continuity);
            setCanManage(payload.canManage);
            setError(null);
        } catch (err) {
            if (!(err instanceof TeamApiError) || err.status >= 500) {
                captureException(err, { context: 'useInstitutionTeam' });
            }
            setError(err instanceof Error ? err.message : 'Failed to load your team');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const onChange = () => void refresh();
        window.addEventListener(TEAM_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(TEAM_CHANGED_EVENT, onChange);
    }, [refresh]);

    return { loading, error, members, continuity, canManage, refresh };
}
