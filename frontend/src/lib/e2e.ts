import type { RoleState } from '@/types';

export interface E2eSessionUser {
    id: string;
    email: string;
    user_metadata?: Record<string, unknown>;
}

export interface E2eSession {
    user: E2eSessionUser;
    access_token: string;
    expires_at?: number;
}

export interface E2eIssuedCredential {
    id: string;
    token_id: string;
    /** Always null for new credentials: documents are no longer on IPFS (review §3.11). */
    ipfs_hash: string | null;
    blockchain_hash: string;
    metadata: {
        credentialData?: {
            studentName?: string;
            degree?: string;
            major?: string;
            gpa?: string;
            issueDate?: string;
            credentialType?: string;
        };
    } | null;
    issued_at: string;
    revoked: boolean;
    issuer_wallet_address: string;
    student_wallet_address: string;
    /** Fake on-chain `credential_hash`; defaults to `blockchain_hash`. */
    credential_hash?: string;
    /** ISO time from which the credential is expired; absent or null if it never expires. */
    expires_at?: string | null;
    share_token?: string;
}

export interface E2eAdminStats {
    totalInstitutions: number;
    authorizedInstitutions: number;
    totalCredentials: number;
    activeCredentials: number;
    totalStudents: number;
    verificationActivity: {
        totalAttempts: number;
        attemptsLast24h: number;
        resultCounts: Record<string, number>;
    };
}

export interface E2eAdminInstitution {
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
}

export interface E2eState {
    enabled?: boolean;
    session?: E2eSession | null;
    role?: RoleState;
    walletAddress?: string | null;
    contractOwner?: string;
    authorizedIssuers?: string[];
    institution?: {
        id: string;
        name: string;
        walletAddress: string;
    };
    stats?: E2eAdminStats;
    /** Rows served by the admin institutions route. */
    adminInstitutions?: E2eAdminInstitution[];
    nextTokenId?: number;
    issuedCredentials?: E2eIssuedCredential[];
}

declare global {
    interface Window {
        __ACREDIA_E2E__?: E2eState;
    }
}

/**
 * Whether this build may run in E2E test mode (review §3.5).
 *
 * E2E mode swaps in a fake session, a fake signer and fake credentials. It
 * used to switch on whenever `window.__ACREDIA_E2E__` existed, so anyone
 * could type it into devtools on production and get a "Verified" screen for
 * a credential that does not exist.
 *
 * Next.js inlines both variables at build time. In a production build this
 * is the constant `false`, so the E2E code is dropped from the bundle — even
 * if NEXT_PUBLIC_E2E were set by mistake in the hosting environment.
 * Playwright sets NEXT_PUBLIC_E2E for the dev server it starts.
 */
export function isE2eBuild(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_E2E === 'true';
}

export function getE2eState(): E2eState | null {
    if (!isE2eBuild() || typeof window === 'undefined') {
        return null;
    }

    return window.__ACREDIA_E2E__ ?? null;
}

export function updateE2eState(mutator: (state: E2eState) => void): E2eState | null {
    // Checked here as well, not only through getE2eState(), so the minifier
    // can drop this whole body from production builds.
    if (!isE2eBuild()) {
        return null;
    }

    const state = getE2eState();
    if (!state) {
        return null;
    }

    mutator(state);
    if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('__ACREDIA_E2E__', JSON.stringify(state));
    }
    return state;
}