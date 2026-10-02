import { e2eLedgerReads, e2eLedgerWrites, isE2eSigner } from './e2eLedger';
import type { StellarSigner } from './stellarSigner';
import type { BatchIssueOutcome } from './contracts';

type Operations = {
    get_owner: { args: []; result: string };
    is_authorized_issuer: { args: [address: string]; result: boolean };
    authorize_issuer: { args: [address: string]; result: string };
    issue_credential: { args: []; result: { tokenId: string; transactionHash: string } };
    batch_issue_credential: { args: [count: number]; result: BatchIssueOutcome };
    revoke_credential: { args: [tokenId: string]; result: string };
};

/**
 * The only switch between the test ledger and real execution. Contract helpers
 * supply a lazy real implementation so fake fixture addresses never reach XDR
 * encoding. Reads have no signer; writes use the explicit fake signer marker,
 * never merely the presence of browser test state.
 */
export async function executeLedgerOperation<M extends keyof Operations>(
    method: M,
    args: Operations[M]['args'],
    signer: StellarSigner | undefined,
    real: () => Promise<Operations[M]['result']>,
): Promise<Operations[M]['result']> {
    if (signer && !isE2eSigner(signer)) return real();

    let result: Operations[keyof Operations]['result'] | null;
    switch (method) {
        case 'get_owner':
            result = e2eLedgerReads.contractOwner();
            break;
        case 'is_authorized_issuer':
            result = e2eLedgerReads.isAuthorizedIssuer(args[0] as string);
            break;
        case 'authorize_issuer':
            if (!signer) throw new Error('A signer is required for contract writes.');
            result = e2eLedgerWrites.authorizeIssuer(signer.address, args[0] as string);
            break;
        case 'issue_credential':
            if (!signer) throw new Error('A signer is required for contract writes.');
            result = e2eLedgerWrites.issueCredential(signer.address);
            break;
        case 'batch_issue_credential': {
            if (!signer) throw new Error('A signer is required for contract writes.');
            const count = args[0] as number;
            const { transactionHash, startTokenId } = e2eLedgerWrites.batchIssueCredential(
                signer.address,
                count,
            );
            result = {
                transactionHash,
                results: Array.from({ length: count }, (_, index) => ({
                    index,
                    success: true,
                    tokenId: String(startTokenId + index),
                    errorCode: null,
                })),
            };
            break;
        }
        case 'revoke_credential':
            if (!signer) throw new Error('A signer is required for contract writes.');
            result = e2eLedgerWrites.revokeCredential(args[0] as string);
            break;
        default:
            throw new Error(`Unsupported ledger operation: ${method}`);
    }

    return result === null ? real() : (result as Operations[M]['result']);
}
