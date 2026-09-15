/**
 * Server-side Soroban read helpers.
 * These run in Node.js (API routes) — no Freighter, no browser SDK quirks.
 * All functions use simulateTransaction for read-only contract calls.
 */
import {
    rpc,
    Contract,
    TransactionBuilder,
    Account,
    TimeoutInfinite,
    scValToNative,
    nativeToScVal,
    xdr,
} from '@stellar/stellar-sdk';
import { credentialHashBytesToHex } from './credentialHashEncoding';
import { runtimeConfig } from './runtimeConfig';
import { getE2eState } from './e2e';

const RPC_URL = runtimeConfig.stellar.sorobanRpcUrl;
const NETWORK_PASSPHRASE = runtimeConfig.stellar.networkPassphrase;
const CONTRACT_ID = runtimeConfig.contracts.CREDENTIAL_NFT;

// Dummy funded account used as transaction source for read-only simulations.
// The contract itself is always present on-ledger, so we borrow its address.
const DUMMY_SOURCE = CONTRACT_ID;

const server = new rpc.Server(RPC_URL);

export class ContractConfigurationError extends Error {
    constructor(message: string = 'Missing contract configuration') {
        super(message);
        this.name = 'ContractConfigurationError';
    }
}

export class BlockchainUnavailableError extends Error {
    constructor(message: string = 'Blockchain verification unavailable') {
        super(message);
        this.name = 'BlockchainUnavailableError';
    }
}

export class CredentialNotFoundError extends Error {
    constructor(message: string = 'Credential not found on chain') {
        super(message);
        this.name = 'CredentialNotFoundError';
    }
}

export interface OnChainCredential {
    token_id?: bigint | number;
    student: string;
    issuer: string;
    hash: string;
    uri: string;
    issued_at: bigint | number;
    revoked?: boolean;
}

 
async function simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
    if (!CONTRACT_ID) {
        throw new ContractConfigurationError('Missing contract configuration: CONTRACT_ID not configured');
    }

    const contract = new Contract(CONTRACT_ID);
    // Use a dummy Account with sequence "0" — valid for read-only simulation
    const source = new Account(DUMMY_SOURCE, '0');

    let sim;
    try {
        const tx = new TransactionBuilder(source, {
            fee: '100',
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(contract.call(method, ...args))
            .setTimeout(TimeoutInfinite)
            .build();
        sim = await server.simulateTransaction(tx as never);
    } catch (error) {
        throw new BlockchainUnavailableError(
            `RPC error during simulation of ${method}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    if ('error' in sim) {
        const errStr = String((sim as { error: string }).error);
        if (
            errStr.includes('CredentialNotFound') ||
            errStr.includes('ContractError(4)') ||
            errStr.includes('Codes(4)') ||
            errStr.includes('Error(Contract, 4)')
        ) {
            throw new CredentialNotFoundError(errStr);
        }
        throw new BlockchainUnavailableError(`Simulation error (${method}): ${errStr}`);
    }
    const retval = (sim as { result?: { retval?: unknown } }).result?.retval;
    if (retval === undefined || retval === null) return null;

    // retval may be an xdr.ScVal object or a base64 string depending on SDK version
    if (typeof retval === 'string') {
        try {
            return scValToNative(xdr.ScVal.fromXDR(retval, 'base64'));
        } catch (error) {
            throw new BlockchainUnavailableError(
                `Failed to decode return value of ${method}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    try {
        return scValToNative(retval as xdr.ScVal);
    } catch (error) {
        throw new BlockchainUnavailableError(
            `Failed to decode return value of ${method}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function nativeStructToRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    if (value instanceof Map) {
        return Object.fromEntries(
            Array.from(value.entries()).map(([key, item]) => [String(key), item]),
        );
    }

    return value as Record<string, unknown>;
}

function firstPresent(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null) {
            return record[key];
        }
    }

    return undefined;
}

export function normalizeOnChainCredential(result: unknown): OnChainCredential | null {
    const record = nativeStructToRecord(result);
    if (!record) {
        return null;
    }

    const credentialHash = firstPresent(record, ['credential_hash', 'credentialHash', 'hash']);
    const ipfsHash = firstPresent(record, ['ipfs_hash', 'ipfsHash', 'uri']);

    if (!credentialHash || !ipfsHash) {
        return null;
    }

    return {
        token_id: firstPresent(record, ['token_id', 'tokenId']) as bigint | number | undefined,
        student: String(firstPresent(record, ['student']) ?? ''),
        issuer: String(firstPresent(record, ['issuer']) ?? ''),
        hash: credentialHashBytesToHex(credentialHash),
        uri: String(ipfsHash),
        issued_at: (firstPresent(record, ['issued_at', 'issuedAt']) as bigint | number) ?? 0,
        revoked: firstPresent(record, ['revoked']) as boolean | undefined,
    };
}

function toU64ScVal(tokenId: string | number): xdr.ScVal {
    try {
        return nativeToScVal(BigInt(tokenId), { type: 'u64' });
    } catch {
        return xdr.ScVal.scvU64(new xdr.Uint64(BigInt(tokenId)));
    }
}

/**
 * Direct on-chain simulation read for get_credential(token_id).
 * Used when the database index is missing or pruned (Issue #232).
 */
export async function getCredentialFromChain(tokenId: string | number): Promise<OnChainCredential | null> {
    try {
        const arg = toU64ScVal(tokenId);
        const result = await simulate('get_credential', [arg]);
        return normalizeOnChainCredential(result);
    } catch (error) {
        if (error instanceof CredentialNotFoundError) {
            return null;
        }
        throw error;
    }
}

/**
 * Direct on-chain simulation read for is_revoked(token_id).
 */
export async function isRevokedFromChain(tokenId: string | number): Promise<boolean> {
    try {
        const arg = toU64ScVal(tokenId);
        const result = await simulate('is_revoked', [arg]);
        return Boolean(result);
    } catch (error) {
        if (error instanceof CredentialNotFoundError) {
            return false;
        }
        throw error;
    }
}

import { getServiceRoleClient } from './serverAuth';

/**
 * Fetch full credential struct by token_id (u64).
 * Checks the database index first, and transparently falls back to
 * live on-chain simulation if the database row is absent (Issue #232).
 */
export async function getCredential(tokenId: string | number): Promise<OnChainCredential | null> {
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        const credential = e2eState.issuedCredentials?.find(
            (entry) => entry.token_id === String(tokenId),
        );

        if (!credential) {
            return null;
        }

        return {
            token_id: Number(credential.token_id),
            student: credential.student_wallet_address,
            issuer: credential.issuer_wallet_address,
            hash: credential.blockchain_hash,
            uri: `ipfs://${credential.ipfs_hash}`,
            issued_at: credential.issued_at ? Date.parse(credential.issued_at) : 0,
            revoked: credential.revoked,
        };
    }

    try {
        const supabase = getServiceRoleClient();
        const { data } = await supabase
            .from('credentials')
            .select('token_id, student_wallet_address, issuer_wallet_address, blockchain_hash, ipfs_hash, issued_at, revoked')
            .eq('token_id', String(tokenId))
            .maybeSingle();

        if (data) {
            return {
                token_id: data.token_id ? Number(data.token_id) : undefined,
                student: data.student_wallet_address || '',
                issuer: data.issuer_wallet_address || '',
                hash: data.blockchain_hash || '',
                uri: data.ipfs_hash ? `ipfs://${data.ipfs_hash}` : '',
                issued_at: data.issued_at ? Date.parse(data.issued_at) : 0,
                revoked: data.revoked || false,
            };
        }
    } catch {
        // Fall through to on-chain read
    }

    try {
        return await getCredentialFromChain(tokenId);
    } catch (error) {
        if (error instanceof BlockchainUnavailableError || error instanceof ContractConfigurationError) {
            throw error;
        }
        return null;
    }
}

/**
 * Look up a credential by its SHA-256 hash.
 * Returns the full credential struct or null if not found.
 */
export async function verifyCredentialByHash(hash: string): Promise<OnChainCredential | null> {
    try {
        const supabase = getServiceRoleClient();
        const { data } = await supabase
            .from('credentials')
            .select('token_id, student_wallet_address, issuer_wallet_address, blockchain_hash, ipfs_hash, issued_at, revoked')
            .eq('blockchain_hash', hash)
            .maybeSingle();

        if (!data) return null;

        return {
            token_id: data.token_id ? Number(data.token_id) : undefined,
            student: data.student_wallet_address || '',
            issuer: data.issuer_wallet_address || '',
            hash: data.blockchain_hash || '',
            uri: data.ipfs_hash ? `ipfs://${data.ipfs_hash}` : '',
            issued_at: data.issued_at ? Date.parse(data.issued_at) : 0,
            revoked: data.revoked || false,
        };
    } catch (error) {
        throw new BlockchainUnavailableError('Database/Index unavailable');
    }
}

/**
 * Check whether a credential has been revoked on-chain.
 */
export async function isRevoked(tokenId: string | number): Promise<boolean> {
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        return Boolean(
            e2eState.issuedCredentials?.find((credential) => credential.token_id === String(tokenId))
                ?.revoked,
        );
    }

    try {
        const supabase = getServiceRoleClient();
        const { data } = await supabase
            .from('credentials')
            .select('revoked')
            .eq('token_id', String(tokenId))
            .maybeSingle();
            
        if (data && typeof data.revoked === 'boolean') {
            return data.revoked;
        }
    } catch {
        // Fall through to on-chain check
    }

    try {
        return await isRevokedFromChain(tokenId);
    } catch {
        return false;
    }
}

export async function isAuthorizedIssuer(issuerAddress: string): Promise<boolean> {
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        return Boolean(
            (e2eState.contractOwner &&
                issuerAddress.toLowerCase() === e2eState.contractOwner.toLowerCase()) ||
                e2eState.authorizedIssuers?.some(
                    (value) => value.toLowerCase() === issuerAddress.toLowerCase(),
                ),
        );
    }

    try {
        const supabase = getServiceRoleClient();
        const { data } = await supabase
            .from('institutions')
            .select('verified, status')
            .eq('wallet_address', issuerAddress)
            .maybeSingle();
            
        return data?.verified === true;
    } catch (error) {
        return false;
    }
}
