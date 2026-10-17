import { safeGetSession } from '@/lib/supabase';
import type { ContinuityAssessment } from '@/lib/institutionContinuity';
import type { InstitutionMemberView } from '@/lib/institutionMembers';

export interface AdminPocInfo {
    id: string;
    fullName: string | null;
    email: string | null;
    isActive: boolean;
    deactivatedAt: string | null;
    deactivatedReason: string | null;
}

export interface AdminAuditLog {
    id: string;
    action: string;
    actorAdminId: string | null;
    requesterEmail: string | null;
    previousPocEmail: string | null;
    newPocEmail: string | null;
    details: Record<string, unknown>;
    createdAt: string | null;
}

export interface AdminInstitutionSummary {
    id: string;
    name: string;
    email: string;
    walletAddress: string | null;
    verified: boolean;
    status: string;
    authorizationTxHash: string | null;
    createdAt: string | null;
    credentialCount: number;
    activeCredentialCount: number;
    poc?: AdminPocInfo | null;
    onboardingState?: OnboardingState;
    invitedAt?: string | null;
    inviteExpiresAt?: string | null;
    inviteAcceptedAt?: string | null;
    /** Who can keep the institution issuing if one person is unavailable (Issue #307). */
    continuity?: ContinuityAssessment;
    /** Most recent account erasure that left nobody able to issue. */
    memberLossAt?: string | null;
    /** Current team; returned by the detail route only. */
    members?: InstitutionMemberView[];
}

/** Provisioning progress: invited -> active -> wallet authorized. */
export type OnboardingState = 'invited' | 'invite_expired' | 'active' | 'wallet_authorized';

export interface AdminInstitutionCredential {
    id: string;
    tokenId: string;
    studentWalletAddress: string | null;
    issuedAt: string | null;
    revoked: boolean;
    revokedAt: string | null;
    degree: string | null;
}

/**
 * Calls an admin API route with the caller's Supabase session attached.
 *
 * Admin routes are protected server-side (session + email allowlist + role), so
 * this only forwards credentials — it never decides access on its own.
 */
export async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const {
        data: { session },
    } = await safeGetSession();

    if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again.');
    }

    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    if (options?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, {
        ...options,
        headers,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Request failed');
    }

    return payload as T;
}

export function formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export function shortenAddress(value: string | null): string {
    if (!value) return '—';
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const STATUS_STYLES: Record<string, string> = {
    verified: 'bg-success/12 text-success border-success/25',
    pending: 'bg-warning/12 text-warning border-warning/25',
    suspended: 'bg-destructive/12 text-destructive border-destructive/25',
    rejected: 'bg-destructive/12 text-destructive border-destructive/25',
};

export function statusBadgeClass(status: string): string {
    return STATUS_STYLES[status] ?? 'bg-secondary text-muted-foreground border-border';
}

const ONBOARDING_LABELS: Record<OnboardingState, string> = {
    invited: 'Invited',
    invite_expired: 'Invite expired',
    active: 'Active',
    wallet_authorized: 'Wallet authorized',
};

const ONBOARDING_STYLES: Record<OnboardingState, string> = {
    invited: 'bg-info/12 text-info border-info/25',
    invite_expired: 'bg-destructive/12 text-destructive border-destructive/25',
    active: 'bg-warning/12 text-warning border-warning/25',
    wallet_authorized: 'bg-success/12 text-success border-success/25',
};

export function onboardingLabel(state: OnboardingState | undefined): string {
    return state ? ONBOARDING_LABELS[state] : '—';
}

export function onboardingBadgeClass(state: OnboardingState | undefined): string {
    return state
        ? ONBOARDING_STYLES[state]
        : 'bg-secondary text-muted-foreground border-border';
}
