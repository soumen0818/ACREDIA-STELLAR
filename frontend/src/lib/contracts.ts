import { signTransaction } from '@stellar/freighter-api';
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

async function invokeContractMethod(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    signerAddress: string,
): Promise<ContractInvocationResult> {
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

    debugLog('Signing transaction with Freighter.');
    let signedXdrResponse: unknown;
    try {
        signedXdrResponse = await signTransaction(preparedTx.toXDR(), {
            networkPassphrase: activeNetwork.networkPassphrase,
            network: activeNetwork.networkName,
        } as never);
    } catch (signError: unknown) {
        const msg = String((signError instanceof Error ? (signError instanceof Error ? signError.message : String(signError)) : String(signError)) || signError);
        if (msg.includes('User canceled') || msg.includes('canceled') || msg.includes('rejected')) {
            throw new Error('Transaction signing was canceled by the user.', { cause: signError });
        }
        if (
            msg.includes('Network') ||
            msg.includes('network') ||
            msg.includes('testnet') ||
            msg.includes('mainnet')
        ) {
            throw new Error(
                `Network mismatch: Your Freighter wallet may be on a different network.\n` +
                    `Expected: ${activeNetwork.networkName}\n` +
                    `${msg}`,
                { cause: signError }
            );
        }
        throw new Error(`Freighter signing error: ${msg}`, { cause: signError });
    }

    const finalXdr =
        typeof signedXdrResponse === 'string'
            ? signedXdrResponse
            : (signedXdrResponse as Record<string, unknown>)?.signedTxXdr || Object.values(signedXdrResponse || {})[0];

    if (!finalXdr || typeof finalXdr !== 'string') {
        throw new Error(
            'Freighter signing failed or wallet account may have disconnected. Please reconnect and try again.',
        );
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

export async function getContractOwner(callerAddress: string): Promise<string> {
    const contractId = getContractAddress('CREDENTIAL_NFT');
    if (!contractId) {
        debugWarn('Contract address is unavailable while loading owner.');
        return '';
    }

    try {
        const result = await simulateRead(contractId, 'get_owner', [], callerAddress);
        return (result as string) || '';
    } catch (error: unknown) {
        debugWarn('Failed to load contract owner.', error instanceof Error ? error.message : String(error));
        return '';
    }
}

export async function isAuthorizedIssuer(
    issuerAddress: string,
    callerAddress: string,
): Promise<boolean> {
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
}

export async function authorizeIssuer(
    adminAddress: string,
    issuerAddress: string,
): Promise<string> {
    const contractId = getContractAddress('CREDENTIAL_NFT');
    const args = [new Address(issuerAddress).toScVal()];
    const result = await invokeContractMethod(contractId, 'authorize_issuer', args, adminAddress);
    return result.transactionHash;
}

export async function issueCredentialOnStellar(
    studentAddress: string,
    credentialHash: string,
    ipfsUri: string,
    issuerAddress: string,
): Promise<{ tokenId: string; transactionHash: string }> {
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

    const result = await invokeContractMethod(contractId, 'issue_credential', args, issuerAddress);
    const tokenId = normalizeTokenId(result.returnValue);

    // eslint-disable-next-line no-console
    console.log('✅ Credential issued on Stellar Network. Token ID:', tokenId);
    // eslint-disable-next-line no-console
    console.log('✅ Transaction:', result.transactionHash);
    return {
        tokenId,
        transactionHash: result.transactionHash,
    };
}

export async function revokeCredentialOnStellar(
    tokenId: string,
    issuerAddress: string,
): Promise<string> {
    // eslint-disable-next-line no-console
    console.log('🗑️ Revoking credential on Stellar Network...');
    const contractId = getContractAddress('CREDENTIAL_NFT');
    const validatedTokenId = normalizeTokenId(tokenId);

    const args = [
        nativeToScVal(Number(validatedTokenId), { type: 'u64' }),
        new Address(issuerAddress).toScVal(),
    ];

    const result = await invokeContractMethod(contractId, 'revoke_credential', args, issuerAddress);
    // eslint-disable-next-line no-console
    console.log('✅ Credential revoked on Stellar Network. Tx:', result.transactionHash);
    return result.transactionHash;
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
