export type CredentialStatus = 'Draft' | 'Pending_Issuance' | 'Issued' | 'Revoked';
export type Action = 'SUBMIT' | 'CONFIRM' | 'REVOKE' | 'DELETE';

export function getNextStatus(current: CredentialStatus, action: Action): CredentialStatus | null {
    const transitions: Record<CredentialStatus, Partial<Record<Action, CredentialStatus>>> = {
        Draft: { SUBMIT: 'Pending_Issuance', DELETE: null as unknown as CredentialStatus },
        Pending_Issuance: { CONFIRM: 'Issued' },
        Issued: { REVOKE: 'Revoked' },
        Revoked: {},
    };

    const next = transitions[current]?.[action];
    if (next === undefined) return null;
    return next;
}
export function validatePayload(payload: unknown): { valid: boolean; error?: string } {
    if (!payload) return { valid: false, error: 'Payload cannot be null' };
    const p = payload as Record<string, unknown>;
    if (typeof p.studentWallet !== 'string' || !p.studentWallet) return { valid: false, error: 'Student wallet is required' };
    if (p.studentWallet.length < 10) return { valid: false, error: 'Invalid wallet address' };

    return { valid: true };
}
