import {
    Account,
    Address,
    Contract,
    StrKey,
    TransactionBuilder,
    TimeoutInfinite,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    nativeToScVal,
    rpc,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { activeNetwork, getContractAddress } from './stellar';

const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const ISSUER_AUTHORIZED_EVENT = 'iss_auth';

export type AuthorizationVerificationFailureCode =
    | 'invalid-wallet'
    | 'invalid-transaction-hash'
    | 'missing-contract'
    | 'invalid-contract'
    | 'pending'
    | 'failed'
    | 'wrong-network'
    | 'wrong-contract'
    | 'wrong-wallet'
    | 'not-authorized'
    | 'rpc-unavailable';

export type AuthorizationVerificationResult =
    | {
          ok: true;
          transactionHash: string;
          walletAddress: string;
          contractId: string;
      }
    | {
          ok: false;
          code: AuthorizationVerificationFailureCode;
          message: string;
          status: number;
      };

type StellarRpcLike = Pick<rpc.Server, 'getTransaction' | 'simulateTransaction'>;

export interface AuthorizationVerificationDeps {
    server?: StellarRpcLike;
    contractId?: string;
    isAuthorizedIssuerOnChain?: (walletAddress: string) => Promise<boolean>;
}

const defaultServer = new rpc.Server(activeNetwork.sorobanRpcUrl);

export function normalizeTransactionHash(transactionHash: unknown): string | null {
    if (typeof transactionHash !== 'string') {
        return null;
    }

    const normalized = transactionHash.trim().toLowerCase();
    return TX_HASH_PATTERN.test(normalized) ? normalized : null;
}

export function isValidIssuerWallet(walletAddress: unknown): walletAddress is string {
    return (
        typeof walletAddress === 'string' && StrKey.isValidEd25519PublicKey(walletAddress.trim())
    );
}

function failure(
    code: AuthorizationVerificationFailureCode,
    message: string,
    status: number,
): AuthorizationVerificationResult {
    return { ok: false, code, message, status };
}

function getTransactionStatus(transaction: unknown): string {
    const status = (transaction as { status?: unknown })?.status;
    return typeof status === 'string' ? status : '';
}

function encodeContractAddress(contractAddress: unknown): string | null {
    if (!contractAddress) {
        return null;
    }

    if (typeof contractAddress === 'string') {
        return StrKey.isValidContract(contractAddress) ? contractAddress : null;
    }

    if (contractAddress instanceof Uint8Array) {
        return contractAddress.length === 32
            ? StrKey.encodeContract(Buffer.from(contractAddress))
            : null;
    }

    if (Array.isArray(contractAddress)) {
        return contractAddress.length === 32
            ? StrKey.encodeContract(Buffer.from(contractAddress))
            : null;
    }

    try {
        const contractId =
            typeof (contractAddress as { contractId?: unknown }).contractId === 'function'
                ? (contractAddress as { contractId: () => unknown }).contractId()
                : null;

        if (contractId) {
            return encodeContractAddress(contractId);
        }

        const value =
            typeof (contractAddress as { value?: unknown }).value === 'function'
                ? (contractAddress as { value: () => unknown }).value()
                : null;

        if (value) {
            return encodeContractAddress(value);
        }
    } catch {
        return null;
    }

    return null;
}

function scValToComparableString(value: unknown): string | null {
    if (value == null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        const native = scValToNative(value as xdr.ScVal);
        return native == null ? null : String(native);
    } catch {
        return null;
    }
}

function getEventBodyV0(event: unknown): unknown {
    const body =
        typeof (event as { body?: unknown }).body === 'function'
            ? (event as { body: () => unknown }).body()
            : (event as { body?: unknown }).body;

    if (!body) {
        return null;
    }

    return typeof (body as { v0?: unknown }).v0 === 'function'
        ? (body as { v0: () => unknown }).v0()
        : ((body as { v0?: unknown }).v0 ?? body);
}

function readEventContractId(event: unknown): string | null {
    const direct = (event as { contractId?: unknown }).contractId;

    if (typeof direct === 'string') {
        return direct;
    }

    if (typeof direct === 'function') {
        return encodeContractAddress((event as { contractId: () => unknown }).contractId());
    }

    return null;
}

function readEventTopics(event: unknown): string[] {
    const plainTopics = (event as { topics?: unknown }).topics;
    if (Array.isArray(plainTopics)) {
        return plainTopics
            .map((topic) => scValToComparableString(topic) ?? String(topic))
            .filter(Boolean);
    }

    const bodyV0 = getEventBodyV0(event);
    const topics =
        bodyV0 && typeof (bodyV0 as { topics?: unknown }).topics === 'function'
            ? (bodyV0 as { topics: () => unknown[] }).topics()
            : null;

    return Array.isArray(topics)
        ? topics
              .map((topic) => scValToComparableString(topic))
              .filter((topic): topic is string => Boolean(topic))
        : [];
}

function readEventData(event: unknown): string | null {
    const plainData = (event as { data?: unknown }).data;
    if (plainData !== undefined) {
        return scValToComparableString(plainData) ?? String(plainData);
    }

    const bodyV0 = getEventBodyV0(event);
    const data =
        bodyV0 && typeof (bodyV0 as { data?: unknown }).data === 'function'
            ? (bodyV0 as { data: () => unknown }).data()
            : null;

    return scValToComparableString(data);
}

function getContractEvents(transaction: unknown): unknown[] {
    const events = (transaction as { events?: { contractEventsXdr?: unknown } })?.events
        ?.contractEventsXdr;
    if (!Array.isArray(events)) {
        return [];
    }

    return events
        .flatMap((operationEvents) =>
            Array.isArray(operationEvents) ? operationEvents : [operationEvents],
        )
        .map((event) => {
            if (typeof event !== 'string') {
                return event;
            }

            try {
                return xdr.ContractEvent.fromXDR(event, 'base64');
            } catch {
                return event;
            }
        });
}

function findAuthorizeIssuerEvent(
    transaction: unknown,
    walletAddress: string,
    contractId: string,
): AuthorizationVerificationResult | null {
    const contractEvents = getContractEvents(transaction);
    let sawAuthorizeEventForAnotherContract = false;
    let sawAuthorizeEventForContract = false;

    for (const event of contractEvents) {
        const topics = readEventTopics(event);
        const isAuthorizeEvent = topics.includes(ISSUER_AUTHORIZED_EVENT);
        if (!isAuthorizeEvent) {
            continue;
        }

        const eventContractId = readEventContractId(event);
        if (eventContractId !== contractId) {
            sawAuthorizeEventForAnotherContract = true;
            continue;
        }

        sawAuthorizeEventForContract = true;
        if (readEventData(event) === walletAddress) {
            return null;
        }
    }

    if (sawAuthorizeEventForContract) {
        return failure(
            'wrong-wallet',
            'Authorization transaction succeeded, but it authorized a different wallet.',
            422,
        );
    }

    return failure(
        'wrong-contract',
        sawAuthorizeEventForAnotherContract
            ? 'Authorization transaction succeeded on a different contract.'
            : 'Transaction does not contain an authorize_issuer event for the configured contract.',
        422,
    );
}

async function defaultIsAuthorizedIssuerOnChain(
    walletAddress: string,
    contractId: string,
    server: StellarRpcLike,
): Promise<boolean> {
    const contract = new Contract(contractId);
    const source = new Account(walletAddress, '0');
    const transaction = new TransactionBuilder(source, {
        fee: '100',
        networkPassphrase: activeNetwork.networkPassphrase,
    })
        .addOperation(contract.call('is_authorized_issuer', new Address(walletAddress).toScVal()))
        .setTimeout(TimeoutInfinite)
        .build();
    const simulation = await server.simulateTransaction(transaction as never);
    if ('error' in simulation) {
        return false;
    }
    const rawResult = (simulation as { result?: { retval?: unknown } })?.result?.retval;
    if (rawResult == null) {
        return false;
    }

    const resultScVal =
        typeof rawResult === 'string' ? xdr.ScVal.fromXDR(rawResult, 'base64') : (rawResult as xdr.ScVal);

    return scValToNative(resultScVal) === true;
}

export async function verifyAdminAuthorizationTransaction(
    walletAddressInput: unknown,
    transactionHashInput: unknown,
    deps: AuthorizationVerificationDeps = {},
): Promise<AuthorizationVerificationResult> {
    if (!isValidIssuerWallet(walletAddressInput)) {
        return failure('invalid-wallet', 'Wallet address must be a valid Stellar public key.', 400);
    }

    const walletAddress = walletAddressInput.trim();
    const transactionHash = normalizeTransactionHash(transactionHashInput);
    if (!transactionHash) {
        return failure(
            'invalid-transaction-hash',
            'Transaction hash must be a 64-character hexadecimal Stellar transaction hash.',
            400,
        );
    }

    const contractId = deps.contractId ?? getContractAddress('CREDENTIAL_NFT');
    if (!contractId) {
        return failure(
            'missing-contract',
            'Credential contract is not configured on the server.',
            500,
        );
    }

    if (!StrKey.isValidContract(contractId)) {
        return failure('invalid-contract', 'Configured credential contract ID is invalid.', 500);
    }

    const server = deps.server ?? defaultServer;

    let transaction: unknown;
    try {
        transaction = await server.getTransaction(transactionHash);
    } catch {
        return failure(
            'rpc-unavailable',
            'Unable to fetch authorization transaction from Stellar RPC.',
            503,
        );
    }

    const status = getTransactionStatus(transaction);
    if (status === 'NOT_FOUND') {
        return failure(
            'wrong-network',
            'Transaction was not found on the configured Stellar network. Confirm it was submitted on the configured network and has finalized.',
            409,
        );
    }

    if (status === 'FAILED') {
        return failure('failed', 'Authorization transaction failed on Stellar.', 422);
    }

    if (status !== 'SUCCESS') {
        return failure('pending', 'Authorization transaction has not succeeded yet.', 409);
    }

    const eventMismatch = findAuthorizeIssuerEvent(transaction, walletAddress, contractId);
    if (eventMismatch) {
        return eventMismatch;
    }

    // eslint-disable-next-line no-useless-assignment
    let isAuthorized = false;
    try {
        isAuthorized = deps.isAuthorizedIssuerOnChain
            ? await deps.isAuthorizedIssuerOnChain(walletAddress)
            : await defaultIsAuthorizedIssuerOnChain(walletAddress, contractId, server);
    } catch {
        return failure(
            'rpc-unavailable',
            'Unable to confirm current issuer authorization state on Stellar RPC.',
            503,
        );
    }

    if (!isAuthorized) {
        return failure(
            'not-authorized',
            'Configured contract does not currently authorize this wallet.',
            422,
        );
    }

    return {
        ok: true,
        transactionHash,
        walletAddress,
        contractId,
    };
}
