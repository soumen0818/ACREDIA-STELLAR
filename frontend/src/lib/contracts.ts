import {
    Account,
    Address,
    Contract,
    nativeToScVal,
    scValToNative,
    StrKey,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { activeNetwork, getContractAddress, sorobanServer } from './stellar';
import { debugLog, debugWarn, captureException } from './debug';
import { generateCanonicalCredentialHash } from './credentialHash';
import { credentialHashHexToScVal } from './credentialHashEncoding';
import { executeLedgerOperation } from './ledgerGateway';
import type { StellarSigner } from './stellarSigner';

export interface CredentialMetadata {
    studentAddress: string;
    credentialHash: string;
    ipfsHash: string;
    issuerAddress: string;
    issuedAt: number;
}

interface ContractInvocationResult<T = unknown> {
    transactionHash: string;
    returnValue: T | null;
}

/**
 * Poll for transaction confirmation after sendTransaction()
 * Soroban transactions are async — sendTransaction() only queues them.
 */
async function waitForConfirmation(hash: string, maxAttempts = 20): Promise<unknown> {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const response = await sorobanServer.getTransaction(hash);

        if (response.status === 'SUCCESS') {
            return response;
        }

        if (response.status === 'FAILED') {
            const resultMeta = (response as unknown as { resultMetaXdr?: string }).resultMetaXdr;
            throw new Error(
                `Transaction FAILED on-chain.\n` +
                    `Hash: ${hash}\n` +
                    `Result: ${resultMeta || 'No result metadata available'}`,
            );
        }

        debugLog(`Waiting for transaction confirmation (attempt ${i + 1}).`);
    }

    throw new Error(`Transaction ${hash} not confirmed after ${maxAttempts} attempts`);
}

/**
 * Builds, simulates, signs and submits one contract call.
 *
 * Exported for tests: with a keypair signer this runs end-to-end against a
 * stubbed RPC, with no browser and no wallet extension involved
 * (ACREDIA-STELLAR#3).
 */
export async function invokeContractMethod(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    signer: StellarSigner,
): Promise<ContractInvocationResult> {
    const signerAddress = signer.address;
    const contract = new Contract(contractId);
    const sourceAccount = await sorobanServer.getAccount(signerAddress);

    const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: activeNetwork.networkPassphrase,
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(300);

    const transaction = txBuilder.build();

    debugLog(`Simulating contract method "${method}".`);
    const simResult = await sorobanServer.simulateTransaction(transaction as never);

    if ('error' in simResult) {
        const errStr = String((simResult as unknown as { error?: unknown }).error);
        if (errStr.includes('Issuer not authorized') || errStr.includes('UnreachableCodeReached')) {
            throw new Error(
                `Your wallet is not authorized to issue credentials.\n\n` +
                    `The contract owner (admin) must first authorize your Stellar address:\n` +
                    `"${signerAddress}"\n\n` +
                    `Ask the admin to use Admin Dashboard -> Authorize Wallet.`,
            );
        }

        throw new Error(`Simulation failed: ${errStr}`);
    }

    debugLog(`Preparing contract method "${method}".`);
    const preparedTx = await sorobanServer.prepareTransaction(transaction as never);

    debugLog('Requesting signature from the signer.');
    let finalXdr: string;
    try {
        // Whoever holds the key — a browser wallet, a keypair in a keeper
        // process, a test — answers the same way: a signed XDR string. This
        // module no longer knows or cares which.
        finalXdr = await signer.signTransaction(preparedTx.toXDR(), {
            networkPassphrase: activeNetwork.networkPassphrase,
        });
    } catch (signError: unknown) {
        const msg = signError instanceof Error ? signError.message : String(signError);

        // Matched on the message rather than on an error class, so this module
        // stays free of wallet imports. The wallet signer raises
        // `WalletUserRejectedError`, whose message says "canceled".
        if (/cancel|reject|denied|declined/i.test(msg)) {
            throw new Error('Transaction signing was canceled by the user.', { cause: signError });
        }

        if (
            msg.includes('Network') ||
            msg.includes('network') ||
            msg.includes('testnet') ||
            msg.includes('mainnet')
        ) {
            throw new Error(
                `Network mismatch: your wallet may be on a different network.\n` +
                    `Expected: ${activeNetwork.networkName}\n` +
                    `${msg}`,
                { cause: signError },
            );
        }
        throw new Error(`Signing error: ${msg}`, { cause: signError });
    }

    const signedTx = TransactionBuilder.fromXDR(finalXdr, activeNetwork.networkPassphrase);
    debugLog('Submitting signed transaction to Stellar.');
    const sendResponse = await sorobanServer.sendTransaction(signedTx as never);

    if (sendResponse.status === 'ERROR') {
        throw new Error(
            `Submission failed: ${sendResponse.errorResult?.toXDR('base64') || 'Unknown error'}`,
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const resultValue = getSorobanTransactionResult(simResult);

    // Wait for on-chain confirmation
    // eslint-disable-next-line no-console
    console.log(`⏳ Waiting for confirmation (hash: ${sendResponse.hash})...`);
    const confirmation = await waitForConfirmation(sendResponse.hash);
    // eslint-disable-next-line no-console
    console.log(`✅ ${method} confirmed on-chain.`);

    return {
        transactionHash: sendResponse.hash,
        returnValue: decodeTransactionReturnValue(confirmation),
    };
}
function decodeTransactionReturnValue(confirmation: unknown): unknown | null {
    const returnValue = (confirmation as { returnValue?: unknown })?.returnValue;
    if (!returnValue) {
        return null;
    }

    try {
        if (typeof returnValue === 'string') {
            return scValToNative(xdr.ScVal.fromXDR(returnValue, 'base64'));
        }

        return scValToNative(returnValue as xdr.ScVal);
    } catch (error) {
        captureException(error, { context: 'decodeReturnValue' });
        return null;
    }
}

export function normalizeTokenId(returnValue: unknown): string {
    if (typeof returnValue === 'bigint') {
        return returnValue.toString();
    }

    if (typeof returnValue === 'number' && Number.isSafeInteger(returnValue) && returnValue >= 0) {
        return String(returnValue);
    }

    if (typeof returnValue === 'string' && /^\d+$/.test(returnValue)) {
        return returnValue;
    }

    throw new Error('Credential transaction confirmed but did not return a valid token ID');
}
export function getSorobanTransactionResult(simResult: unknown): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sim = simResult as any;
    const rawResult =
        sim?.result?.retval ||
        sim?.result?.result?.retval ||
        sim?.retval ||
        sim?.result?.xdr?.retval;

    if (rawResult == null) {
        return null;
    }

    try {
        if (typeof rawResult === 'string') {
            const scval = xdr.ScVal.fromXDR(rawResult, 'base64');
            return scValToNative(scval);
        }

        if (typeof rawResult === 'object' && (rawResult.switch || rawResult._switch)) {
            return scValToNative(rawResult);
        }

        return rawResult;
    } catch (e) {
        captureException(e, { context: 'getSorobanTransactionResult' });
        return null;
    }
}

async function simulateRead(
    contractId: string,
    method: string,
    args: unknown[] = [],
    sourceAddress: string,
): Promise<unknown> {
    const contract = new Contract(contractId);
    let sourceAccount;

    try {
        sourceAccount = await sorobanServer.getAccount(sourceAddress);
    } catch {
        sourceAccount = new Account(sourceAddress, '0');
    }

    const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: activeNetwork.networkPassphrase,
    })
        .addOperation(contract.call(method, ...(args as xdr.ScVal[])))
        .setTimeout(TimeoutInfinite);
    const sim = await sorobanServer.simulateTransaction(txBuilder.build() as never);
    if ('error' in sim) {
        debugWarn('simulateRead failed.', (sim as unknown as { error?: string }).error);
        return null;
    }

    return getSorobanTransactionResult(sim);
}

/**
 * Reads the contract owner.
 *
 * Takes an address rather than a signer: this only simulates, never submits,
 * and one caller is a server route with no wallet at all. A signer here would
 * be a dependency nobody could satisfy.
 */
export async function getContractOwner(callerAddress: string): Promise<string> {
    return executeLedgerOperation('get_owner', [], undefined, async () => {
        const contractId = getContractAddress('CREDENTIAL_NFT');
        if (!contractId) {
            debugWarn('Contract address is unavailable while loading owner.');
            return '';
        }

        try {
            const result = await simulateRead(contractId, 'get_owner', [], callerAddress);
            return (result as string) || '';
        } catch (error: unknown) {
            debugWarn(
                'Failed to load contract owner.',
                error instanceof Error ? error.message : String(error),
            );
            return '';
        }
    });
}

/** Reads an issuer's authorization. Read-only, so it takes an address, not a signer. */
export async function isAuthorizedIssuer(
    issuerAddress: string,
    callerAddress: string,
): Promise<boolean> {
    return executeLedgerOperation('is_authorized_issuer', [issuerAddress], undefined, async () => {
        const contractId = getContractAddress('CREDENTIAL_NFT');

        try {
            const result = await simulateRead(
                contractId,
                'is_authorized_issuer',
                [new Address(issuerAddress).toScVal()],
                callerAddress,
            );
            return result === true;
        } catch (error) {
            debugWarn('Failed to check issuer authorization.', error);
            return false;
        }
    });
}

export async function authorizeIssuer(
    admin: StellarSigner,
    issuerAddress: string,
): Promise<string> {
    return executeLedgerOperation('authorize_issuer', [issuerAddress], admin, async () => {
        const contractId = getContractAddress('CREDENTIAL_NFT');
        const args = [new Address(issuerAddress).toScVal()];
        const result = await invokeContractMethod(contractId, 'authorize_issuer', args, admin);
        return result.transactionHash;
    });
}

export async function issueCredentialOnStellar(
    studentAddress: string,
    credentialHash: string,
    ipfsUri: string,
    issuer: StellarSigner,
): Promise<{ tokenId: string; transactionHash: string }> {
    return executeLedgerOperation('issue_credential', [], issuer, async () => {
        const issuerAddress = issuer.address;

        debugLog('Issuing credential on Stellar.');

        const authorized = await isAuthorizedIssuer(issuerAddress, issuerAddress);
        if (!authorized) {
            throw new Error(
                `Your wallet ("${issuerAddress}") is not authorized to issue credentials.\n\n` +
                    `The contract admin must authorize your wallet first via:\n` +
                    `Admin Dashboard -> "Authorize Wallet" -> enter your Stellar address.`,
            );
        }

        const contractId = getContractAddress('CREDENTIAL_NFT');
        const args = [
            new Address(studentAddress).toScVal(),
            new Address(issuerAddress).toScVal(),
            credentialHashHexToScVal(credentialHash),
            nativeToScVal(ipfsUri, { type: 'string' }),
        ];

        const result = await invokeContractMethod(contractId, 'issue_credential', args, issuer);
        const tokenId = normalizeTokenId(result.returnValue);

        // eslint-disable-next-line no-console
        console.log('✅ Credential issued on Stellar Network. Token ID:', tokenId);
        // eslint-disable-next-line no-console
        console.log('✅ Transaction:', result.transactionHash);
        return {
            tokenId,
            transactionHash: result.transactionHash,
        };
    });
}

/** Mirrors MAX_BATCH_SIZE in contracts/src/lib.rs — keep these in sync. */
export const CONTRACT_MAX_BATCH_SIZE = 20;

/** Mirrors ContractError::CredentialAlreadyExists = 3 in contracts/src/lib.rs. */
const CONTRACT_ERROR_CREDENTIAL_ALREADY_EXISTS = 3;
// ContractError::UriTooLarge — the contract caps ipfs_uri at MAX_IPFS_URI_LEN
// (256 bytes); see contracts/src/lib.rs.
const CONTRACT_ERROR_URI_TOO_LARGE = 14;

export interface BatchCredentialInputItem {
    studentAddress: string;
    credentialHash: string; // 64-char sha256 hex
    ipfsUri: string;
}

export interface BatchIssueRowResult {
    index: number;
    success: boolean;
    tokenId: string | null; // null when success === false
    errorCode: number | null; // null when success === true
}

export interface BatchIssueOutcome {
    transactionHash: string;
    results: BatchIssueRowResult[];
}

export function describeBatchRowError(errorCode: number | null): string {
    if (errorCode === CONTRACT_ERROR_CREDENTIAL_ALREADY_EXISTS) {
        return 'A credential with this exact hash already exists (duplicate row, or already issued previously).';
    }
    if (errorCode === CONTRACT_ERROR_URI_TOO_LARGE) {
        return 'The metadata URI for this row is too long (the contract caps it at 256 bytes).';
    }
    return errorCode == null ? 'Unknown error' : `Contract error ${errorCode}`;
}

/**
 * Builds an ScVal for a Soroban `#[contracttype]` struct. Field keys must be
 * ScVal symbols (not strings), sorted ascending by field name — the
 * generated Rust decoder does a binary_search_by_key over field-name symbols
 * (soroban-sdk-macros' derive_struct), so an unsorted or string-keyed map
 * traps on the host. The generic nativeToScVal(plainObject) must NOT be used
 * for this — it defaults object keys to ScVal.scvString, not scvSymbol.
 */
function structScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
    const sortedKeys = Object.keys(fields).sort();
    return xdr.ScVal.scvMap(
        sortedKeys.map(
            (key) =>
                new xdr.ScMapEntry({
                    key: nativeToScVal(key, { type: 'symbol' }),
                    val: fields[key],
                }),
        ),
    );
}

export function batchCredentialInputToScVal(item: BatchCredentialInputItem): xdr.ScVal {
    return structScVal({
        credential_hash: credentialHashHexToScVal(item.credentialHash),
        ipfs_uri: nativeToScVal(item.ipfsUri, { type: 'string' }),
        student: new Address(item.studentAddress).toScVal(),
    });
}

function normalizeBatchIssueRow(row: unknown, fallbackIndex: number): BatchIssueRowResult {
    const record = (row ?? {}) as Record<string, unknown>;
    const success = record.success === true;
    const rawIndex = record.index;
    const index =
        typeof rawIndex === 'bigint'
            ? Number(rawIndex)
            : typeof rawIndex === 'number'
              ? rawIndex
              : fallbackIndex;

    return {
        index,
        success,
        tokenId: success ? normalizeTokenId(record.token_id) : null,
        errorCode: success ? null : Number(record.error_code ?? -1),
    };
}

/**
 * Issues up to CONTRACT_MAX_BATCH_SIZE credentials from a single issuer in
 * one call/signature. A bad row (e.g. a duplicate hash) does not fail the
 * whole call — it comes back as a failed BatchIssueRowResult alongside the
 * successful ones, matching batch_issue_credential's partial-failure
 * semantics on-chain. Callers with more rows than the max must split into
 * multiple sequential calls (see chunkRows in batchCredentialImport.ts).
 */
export async function batchIssueCredentialOnStellar(
    items: BatchCredentialInputItem[],
    issuer: StellarSigner,
): Promise<BatchIssueOutcome> {
    if (items.length === 0) {
        throw new Error('Cannot issue an empty batch.');
    }
    if (items.length > CONTRACT_MAX_BATCH_SIZE) {
        throw new Error(
            `Batch of ${items.length} exceeds the contract's max batch size of ${CONTRACT_MAX_BATCH_SIZE}.`,
        );
    }

    return executeLedgerOperation('batch_issue_credential', [items.length], issuer, async () => {
        const issuerAddress = issuer.address;

        debugLog('Issuing credential batch on Stellar.');

        const authorized = await isAuthorizedIssuer(issuerAddress, issuerAddress);
        if (!authorized) {
            throw new Error(
                `Your wallet ("${issuerAddress}") is not authorized to issue credentials.\n\n` +
                    `The contract admin must authorize your wallet first via:\n` +
                    `Admin Dashboard -> "Authorize Wallet" -> enter your Stellar address.`,
            );
        }

        const contractId = getContractAddress('CREDENTIAL_NFT');
        const itemsScVal = xdr.ScVal.scvVec(items.map(batchCredentialInputToScVal));
        const args = [new Address(issuerAddress).toScVal(), itemsScVal];

        const result = await invokeContractMethod(
            contractId,
            'batch_issue_credential',
            args,
            issuer,
        );

        const rawRows = Array.isArray(result.returnValue) ? result.returnValue : [];
        const results = rawRows.map((row, index) => normalizeBatchIssueRow(row, index));

        // eslint-disable-next-line no-console
        console.log(
            `✅ Credential batch issued on Stellar Network. ${results.filter((r) => r.success).length}/${results.length} succeeded.`,
        );
        // eslint-disable-next-line no-console
        console.log('✅ Transaction:', result.transactionHash);

        return { transactionHash: result.transactionHash, results };
    });
}

export async function revokeCredentialOnStellar(
    tokenId: string,
    issuer: StellarSigner,
): Promise<string> {
    return executeLedgerOperation(
        'revoke_credential',
        [normalizeTokenId(tokenId)],
        issuer,
        async () => {
            // eslint-disable-next-line no-console
            console.log('🗑️ Revoking credential on Stellar Network...');
            const contractId = getContractAddress('CREDENTIAL_NFT');
            const validatedTokenId = normalizeTokenId(tokenId);

            const args = [
                nativeToScVal(Number(validatedTokenId), { type: 'u64' }),
                new Address(issuer.address).toScVal(),
            ];

            const result = await invokeContractMethod(
                contractId,
                'revoke_credential',
                args,
                issuer,
            );
            // eslint-disable-next-line no-console
            console.log('✅ Credential revoked on Stellar Network. Tx:', result.transactionHash);
            return result.transactionHash;
        },
    );
}
export async function generateCredentialHash(metadata: unknown): Promise<string> {
    return generateCanonicalCredentialHash(metadata);
}

export function isValidStellarAddress(address: string): boolean {
    return StrKey.isValidEd25519PublicKey(address);
}

export function isValidAddress(address: string): boolean {
    return isValidStellarAddress(address);
}

export function formatStellarAddress(address: string, length = 8): string {
    if (!address || address.length < 2 * length) return address;
    return `${address.substring(0, length)}...${address.substring(address.length - length)}`;
}
