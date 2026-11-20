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
import { runtimeConfig, serverRuntimeConfig } from './runtimeConfig';
import { captureException, recordMetric } from './debug';
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

// ---------------------------------------------------------------------------
// RPC endpoints and failover — Issue #313
// ---------------------------------------------------------------------------

/**
 * Per-request bound for one RPC endpoint. A hanging endpoint used to hold a
 * verification open until the platform killed the function; now it fails
 * over (or answers from the last known result) within this bound.
 */
export const RPC_REQUEST_TIMEOUT_MS = 4_000;

/** How long an endpoint that just failed is tried last instead of first. */
export const RPC_ENDPOINT_COOLDOWN_MS = 30_000;

interface RpcEndpoint {
    /** `primary` or `fallback-N`: endpoint URLs can carry API keys, so our messages name this instead. */
    label: string;
    primary: boolean;
    server: rpc.Server;
    /**
     * Fallbacks are free-form server configuration, so each must prove it
     * serves our network before it is trusted: one on another network would
     * answer "not found" for every real credential.
     */
    network: 'trusted' | 'unchecked' | 'mismatch';
    failedUntil: number;
}

let endpoints: RpcEndpoint[] | null = null;

function createServer(url: string): rpc.Server {
    return new rpc.Server(url, {
        timeout: RPC_REQUEST_TIMEOUT_MS,
        // A local RPC in development only. In production every endpoint must
        // be HTTPS (runtimeConfig rejects an HTTP fallback there too).
        allowHttp: url.startsWith('http:') && !runtimeConfig.isProduction,
    });
}

function rpcEndpoints(): RpcEndpoint[] {
    if (endpoints) return endpoints;
    const fallbackUrls = serverRuntimeConfig.stellar?.sorobanRpcFallbackUrls ?? [];
    endpoints = [
        // The primary is the network profile's own RPC, so its network is known.
        { label: 'primary', primary: true, server: createServer(RPC_URL), network: 'trusted', failedUntil: 0 },
        ...fallbackUrls.map((url, index): RpcEndpoint => ({
            label: `fallback-${index + 1}`,
            primary: false,
            server: createServer(url),
            network: 'unchecked',
            failedUntil: 0,
        })),
    ];
    return endpoints;
}

/** Drops the endpoints and their health, so the next read rebuilds them from config. */
export function resetRpcEndpointsForTests(): void {
    endpoints = null;
}

/**
 * Endpoints in the order to try them: configured order, except that one
 * which failed within the cooldown goes last. It is still tried, as a last
 * resort, so a single blip cannot take every endpoint out of rotation.
 */
function endpointsInTryOrder(now: number): RpcEndpoint[] {
    const usable = rpcEndpoints().filter((endpoint) => endpoint.network !== 'mismatch');
    return [
        ...usable.filter((endpoint) => endpoint.failedUntil <= now),
        ...usable.filter((endpoint) => endpoint.failedUntil > now),
    ];
}

async function assertSameNetwork(endpoint: RpcEndpoint): Promise<void> {
    if (endpoint.network === 'trusted') return;
    let passphrase: string;
    try {
        passphrase = (await endpoint.server.getNetwork()).passphrase;
    } catch (error) {
        // Unreachable: an ordinary failure, checked again on the next try.
        throw new BlockchainUnavailableError(
            `RPC ${endpoint.label} network check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (passphrase !== NETWORK_PASSPHRASE) {
        endpoint.network = 'mismatch';
        captureException(new Error(`Soroban RPC ${endpoint.label} serves another network; it is not used.`), {
            context: 'contractReads.rpcFailover',
            endpoint: endpoint.label,
        });
        throw new BlockchainUnavailableError(`RPC ${endpoint.label} serves another network`);
    }
    endpoint.network = 'trusted';
}

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

/** A contract-level answer (`Error(Contract, #N)`): the same on every endpoint, so never failed over. */
class ContractAnswerError extends BlockchainUnavailableError {}

/** The simulation's return value, or the contract's answer as an error. */
function interpretSimulation(method: string, sim: unknown): unknown {
    if (sim && typeof sim === 'object' && 'error' in sim) {
        const errStr = String((sim as { error: unknown }).error);
        // The RPC renders contract errors as `Error(Contract, #4)`; 4 is
        // CredentialNotFound. The exact match keeps #40 from counting.
        if (/Error\(Contract, #?4\)/.test(errStr)) {
            throw new CredentialNotFoundError(errStr);
        }
        // Any other contract error is still an answer, not an outage of this
        // endpoint, but the caller cannot use it: fail closed as unavailable.
        if (/Error\(Contract, #?\d+\)/.test(errStr)) {
            throw new ContractAnswerError(`Simulation error (${method}): ${errStr}`);
        }
        throw new BlockchainUnavailableError(`Simulation error (${method}): ${errStr}`);
    }
    const retval = (sim as { result?: { retval?: unknown } } | null)?.result?.retval;
    if (retval === undefined || retval === null) return null;

    // retval may be an xdr.ScVal object or a base64 string depending on SDK version
    try {
        return scValToNative(typeof retval === 'string' ? xdr.ScVal.fromXDR(retval, 'base64') : (retval as xdr.ScVal));
    } catch (error) {
        throw new BlockchainUnavailableError(
            `Failed to decode return value of ${method}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Simulates a read-only contract call, trying each RPC endpoint in turn
 * (issue #313). It moves to the next endpoint only when this one cannot
 * answer: a transport error, a timeout, an RPC-level error or an unreadable
 * reply. A contract answer, above all "not found", is returned or thrown at
 * once, never retried elsewhere in the hope of a different one.
 *
 * Throws `BlockchainUnavailableError` once every endpoint has failed.
 */
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

    let tx;
    try {
        tx = new TransactionBuilder(source, {
            fee: '100',
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(contract.call(method, ...args))
            .setTimeout(TimeoutInfinite)
            .build();
    } catch (error) {
        throw new BlockchainUnavailableError(
            `Could not build the ${method} simulation: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const failures: string[] = [];
    for (const endpoint of endpointsInTryOrder(Date.now())) {
        try {
            await assertSameNetwork(endpoint);
            let sim: unknown;
            try {
                sim = await endpoint.server.simulateTransaction(tx as never);
            } catch (error) {
                throw new BlockchainUnavailableError(
                    `RPC error during simulation of ${method}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            const value = interpretSimulation(method, sim);
            endpoint.failedUntil = 0;
            if (!endpoint.primary) {
                recordMetric('verification.rpc.fallback_answered', 1, { method, endpoint: endpoint.label });
            }
            return value;
        } catch (error) {
            if (error instanceof CredentialNotFoundError || error instanceof ContractAnswerError) {
                // The endpoint answered; the answer is the contract's.
                endpoint.failedUntil = 0;
                throw error;
            }
            endpoint.failedUntil = Date.now() + RPC_ENDPOINT_COOLDOWN_MS;
            failures.push(`${endpoint.label}: ${error instanceof Error ? error.message : String(error)}`);
            recordMetric('verification.rpc.endpoint_failed', 1, { method, endpoint: endpoint.label });
        }
    }

    throw new BlockchainUnavailableError(
        failures.length > 0
            ? `Every Soroban RPC endpoint failed for ${method}. ${failures.join(' | ')}`
            : `No usable Soroban RPC endpoint for ${method}`,
    );
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
