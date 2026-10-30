/** All possible application roles. */
export type AppRole = 'student' | 'institution' | 'admin';

/**
 * Role states used by the auth system, including transient states.
 * - `'loading'`: role resolution is in progress (initial render)
 * - `'unknown'`: role could not be determined (e.g. network error)
 * - `'unprovisioned'`: user authenticated but has no valid role assigned
 */
export type RoleState = AppRole | 'unknown' | 'loading' | 'unprovisioned';

/** @deprecated Use `AppRole` instead. Kept for backward compatibility. */
export type UserRole = AppRole;

export interface Institution {
    id: string;
    email: string;
    name: string;
    wallet_address?: string;
    verified: boolean;
    status?: 'pending' | 'verified' | 'suspended' | 'rejected';
    created_at: string;
}

export interface Student {
    id: string;
    email: string;
    name: string;
    wallet_address?: string;
    created_at: string;
}

export interface Credential {
    id: string;
    student_id: string;
    institution_id: string;
    token_id: string;
    /** Retired with IPFS (review §3.11); null for every new credential. */
    ipfs_hash: string | null;
    /** The holder's share link token: `/credentials/<share_token>`. */
    share_token: string;
    document_path: string | null;
    document_sha256: string | null;
    expires_at: string | null;
    blockchain_hash: string;
    metadata: CredentialMetadata;
    metadata_schema_version: number;
    hash_algorithm: string;
    issued_at: string;
    revoked: boolean;
}

export interface CredentialMetadata {
    student_name: string;
    institution_name: string;
    credential_type: string;
    degree?: string;
    field_of_study?: string;
    graduation_date?: string;
    gpa?: number;
    description?: string;
    image_url?: string;
}

export interface VerificationResult {
    valid: boolean;
    credential?: Credential;
    institution?: Institution;
    message: string;
    verified_at: string;
}

export interface AuthUser {
    id: string;
    email: string;
    role: AppRole;
    profile?: Institution | Student;
}
