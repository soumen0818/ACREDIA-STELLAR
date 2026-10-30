/**
 * Server-side Soroban read helpers.
 * These run in Node.js (API routes) — no wallet, no browser SDK quirks.
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
    Address,
    contract as sorobanContract,
} from '@stellar/stellar-sdk';
import { credentialHashBytesToHex } from './credentialHashEncoding';
import { runtimeConfig } from './runtimeConfig';
import { getE2eState } from './e2e';

const RPC_URL = runtimeConfig.stellar.sorobanRpcUrl;
const NETWORK_PASSPHRASE = runtimeConfig.stellar.networkPassphrase;
const CONTRACT_ID = runtimeConfig.contracts.CREDENTIAL_NFT;

// Source account for read-only simulations. Simulation does not need the
// account to exist, so this is the SDK's own all-zero placeholder, as its
// contract client uses. It must be a G-address: the contract ID used to be
// borrowed here, and the SDK rejects a C-address as an account, so every
// chain read failed before reaching the RPC (review §3.11b).
const SIMULATION_SOURCE = sorobanContract.NULL_ACCOUNT;

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
    tokenId: string;
    student: string;
    issuer: string;
    /** Lowercase hex of the on-chain `credential_hash`. */
    hash: string;
    /** Ledger timestamp of issuance, in Unix seconds. */
    issuedAt: number;
    /** Unix seconds from which the credential is expired, or null if it never expires. */
    expiresAt: number | null;
    /** Revocation flag as read; may be stale if cached, so re-check with `isRevokedFromChain`. */
    revoked: boolean;
}

async function simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
    if (!CONTRACT_ID) {
        throw new ContractConfigurationError('Missing contract configuration: CONTRACT_ID not configured');
    }

    let contract: Contract;
    try {
        contract = new Contract(CONTRACT_ID);
    } catch {
        throw new ContractConfigurationError(`Invalid contract ID: ${CONTRACT_ID}`);
    }
    // Sequence "0" is fine: the transaction is only simulated, never submitted.
    const source = new Account(SIMULATION_SOURCE, '0');

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
        // The RPC renders contract errors as `Error(Contract, #4)`; 4 is
        // CredentialNotFound. The exact match keeps #40 from counting.
        if (/Error\(Contract, #?4\)/.test(errStr)) {
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

function toSeconds(value: unknown): number | null {
    if (value === undefined || value === null) {
        return null;
    }
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Maps the contract's `Credential` struct to plain JSON-safe values. Numbers
 * rather than bigints: the verification cache serializes this with
 * `JSON.stringify`, which throws on a bigint.
 */
export function normalizeOnChainCredential(result: unknown): OnChainCredential | null {
    const record = nativeStructToRecord(result);
    if (!record?.credential_hash) {
        return null;
    }

    return {
        tokenId: String(record.token_id ?? ''),
        student: String(record.student ?? ''),
        issuer: String(record.issuer ?? ''),
        hash: credentialHashBytesToHex(record.credential_hash),
        issuedAt: toSeconds(record.issued_at) ?? 0,
        expiresAt: toSeconds(record.expires_at),
        revoked: record.revoked === true,
    };
}

function toU64ScVal(tokenId: string | number): xdr.ScVal {
    try {
        return nativeToScVal(BigInt(tokenId), { type: 'u64' });
    } catch {
        return xdr.ScVal.scvU64(xdr.Uint64(BigInt(tokenId)));
    }
}

function e2eCredential(tokenId: string | number) {
    return getE2eState()?.issuedCredentials?.find((entry) => entry.token_id === String(tokenId));
}

/*
 * Every read below goes to the contract. None of them consults the database:
 * verification must not be satisfiable by editing a credentials row (review
 * §2 correction, §3.11b). E2E builds read the fake ledger instead.
 */

/** `get_credential(token_id)`, or null when the contract has no such token. */
export async function getCredentialFromChain(tokenId: string | number): Promise<OnChainCredential | null> {
    if (getE2eState()?.enabled) {
        const credential = e2eCredential(tokenId);
        return credential
            ? {
                  tokenId: credential.token_id,
                  student: credential.student_wallet_address,
                  issuer: credential.issuer_wallet_address,
                  hash: credential.credential_hash ?? credential.blockchain_hash,
                  issuedAt: Math.floor(Date.parse(credential.issued_at) / 1000),
                  expiresAt: credential.expires_at
                      ? Math.floor(Date.parse(credential.expires_at) / 1000)
                      : null,
                  revoked: credential.revoked,
              }
            : null;
    }

    try {
        const result = await simulate('get_credential', [toU64ScVal(tokenId)]);
        return normalizeOnChainCredential(result);
    } catch (error) {
        if (error instanceof CredentialNotFoundError) {
            return null;
        }
        throw error;
    }
}

/**
 * `is_revoked(token_id)`. Throws `BlockchainUnavailableError` when the chain
 * cannot be read: answering "not revoked" during an outage would let a
 * revoked credential verify.
 */
export async function isRevokedFromChain(tokenId: string | number): Promise<boolean> {
    if (getE2eState()?.enabled) {
        return Boolean(e2eCredential(tokenId)?.revoked);
    }

    try {
        return Boolean(await simulate('is_revoked', [toU64ScVal(tokenId)]));
    } catch (error) {
        if (error instanceof CredentialNotFoundError) {
            return false;
        }
        throw error;
    }
}

/** `is_authorized_issuer(issuer)`. Throws when the chain cannot be read. */
export async function isAuthorizedIssuerOnChain(issuerAddress: string): Promise<boolean> {
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        const address = issuerAddress.toLowerCase();
        return Boolean(
            e2eState.contractOwner?.toLowerCase() === address ||
                e2eState.authorizedIssuers?.some((value) => value.toLowerCase() === address),
        );
    }

    return Boolean(
        await simulate('is_authorized_issuer', [new Address(issuerAddress).toScVal()]),
    );
}
