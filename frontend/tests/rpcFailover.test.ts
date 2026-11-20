/**
 * Issue #313 — Soroban RPC failover for server-side chain reads.
 *
 * Runs the real `contractReads` over real `rpc.Server` instances; only the
 * network calls (`simulateTransaction`, `getNetwork`) are stubbed, per
 * endpoint, so each failure mode can be produced on demand.
 */
import { rpc, StrKey, xdr } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PRIMARY = 'https://rpc-primary.test';
const FALLBACK_1 = 'https://rpc-fallback-one.test/key/s3cr3t';
const FALLBACK_2 = 'https://rpc-fallback-two.test';
const PASSPHRASE = 'Test SDF Network ; September 2015';

vi.mock('../src/lib/runtimeConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/runtimeConfig')>();
    const { StrKey: keys } = await import('@stellar/stellar-sdk');
    return {
        ...actual,
        runtimeConfig: {
            ...actual.runtimeConfig,
            stellar: {
                ...actual.runtimeConfig.stellar,
                sorobanRpcUrl: 'https://rpc-primary.test',
                networkPassphrase: 'Test SDF Network ; September 2015',
            },
            contracts: { ...actual.runtimeConfig.contracts, CREDENTIAL_NFT: keys.encodeContract(Buffer.alloc(32, 1)) },
        },
        serverRuntimeConfig: {
            ...actual.serverRuntimeConfig,
            stellar: {
                sorobanRpcFallbackUrls: ['https://rpc-fallback-one.test/key/s3cr3t', 'https://rpc-fallback-two.test'],
            },
        },
    };
});

const {
    BlockchainUnavailableError,
    getCredentialFromChain,
    isAuthorizedIssuerOnChain,
    isRevokedFromChain,
    resetRpcEndpointsForTests,
    RPC_ENDPOINT_COOLDOWN_MS,
    RPC_REQUEST_TIMEOUT_MS,
} = await import('../src/lib/contractReads');

type Behaviour =
    | { kind: 'answer'; value: xdr.ScVal }
    | { kind: 'reject'; error: Error }
    | { kind: 'rpc-error'; error: string }
    | { kind: 'hang' };

const behaviours = new Map<string, Behaviour>();
const networks = new Map<string, string | Error>();
const calls: string[] = [];
const networkChecks: string[] = [];
const timeouts = new Map<string, unknown>();

/** The endpoint a server instance was built for, without a trailing slash. */
function urlOf(server: rpc.Server): string {
    return server.serverURL.toString().replace(/\/$/, '');
}

const answer = (value: xdr.ScVal): Behaviour => ({ kind: 'answer', value });
const reject = (message: string): Behaviour => ({ kind: 'reject', error: new Error(message) });
const rpcError = (error: string): Behaviour => ({ kind: 'rpc-error', error });

beforeEach(() => {
    resetRpcEndpointsForTests();
    behaviours.clear();
    networks.clear();
    calls.length = 0;
    networkChecks.length = 0;
    timeouts.clear();
    for (const url of [PRIMARY, FALLBACK_1, FALLBACK_2]) networks.set(url, PASSPHRASE);

    vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockImplementation(async function (this: rpc.Server) {
        const url = urlOf(this);
        calls.push(url);
        timeouts.set(url, (this as unknown as { httpClient: { defaults: { timeout?: unknown } } }).httpClient.defaults.timeout);
        const behaviour = behaviours.get(url) ?? reject(`no behaviour for ${url}`);
        if (behaviour.kind === 'reject') throw behaviour.error;
        if (behaviour.kind === 'hang') {
            // What the SDK raises once RPC_REQUEST_TIMEOUT_MS passes.
            throw new Error(`timeout of ${RPC_REQUEST_TIMEOUT_MS} ms exceeded`);
        }
        if (behaviour.kind === 'rpc-error') return { error: behaviour.error } as never;
        return { result: { retval: behaviour.value } } as never;
    });
    vi.spyOn(rpc.Server.prototype, 'getNetwork').mockImplementation(async function (this: rpc.Server) {
        const url = urlOf(this);
        networkChecks.push(url);
        const network = networks.get(url);
        if (network instanceof Error) throw network;
        return { passphrase: network, protocolVersion: 22 } as never;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('RPC failover (issue #313)', () => {
    it('reads from the primary alone while it answers', async () => {
        behaviours.set(PRIMARY, answer(xdr.ScVal.scvBool(true)));

        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(calls).toEqual([PRIMARY]);
        // The primary is the network profile's own RPC: not re-checked.
        expect(networkChecks).toEqual([]);
    });

    it('bounds every endpoint with the request timeout', async () => {
        behaviours.set(PRIMARY, reject('down'));
        behaviours.set(FALLBACK_1, reject('down'));
        behaviours.set(FALLBACK_2, reject('down'));

        await expect(isRevokedFromChain('7')).rejects.toBeInstanceOf(BlockchainUnavailableError);
        expect(Object.fromEntries(timeouts)).toEqual({
            [PRIMARY]: RPC_REQUEST_TIMEOUT_MS,
            [FALLBACK_1]: RPC_REQUEST_TIMEOUT_MS,
            [FALLBACK_2]: RPC_REQUEST_TIMEOUT_MS,
        });
    });

    it('fails over to the fallback when the primary times out', async () => {
        behaviours.set(PRIMARY, { kind: 'hang' });
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));

        await expect(isRevokedFromChain('7')).resolves.toBe(false);
        expect(calls).toEqual([PRIMARY, FALLBACK_1]);
    });

    it('fails over when the primary returns an RPC error', async () => {
        behaviours.set(PRIMARY, rpcError('HostError: Error(Budget, ExceededLimit) — node overloaded'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(true)));

        await expect(isAuthorizedIssuerOnChain(StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2)))).resolves.toBe(true);
        expect(calls).toEqual([PRIMARY, FALLBACK_1]);
    });

    it('fails over when the primary refuses the connection', async () => {
        behaviours.set(PRIMARY, reject('connect ECONNREFUSED'));
        behaviours.set(FALLBACK_1, reject('getaddrinfo ENOTFOUND'));
        behaviours.set(FALLBACK_2, answer(xdr.ScVal.scvBool(false)));

        await expect(isRevokedFromChain('7')).resolves.toBe(false);
        expect(calls).toEqual([PRIMARY, FALLBACK_1, FALLBACK_2]);
    });

    it('never fails over on "not found": that is the contract\'s answer', async () => {
        behaviours.set(PRIMARY, rpcError('HostError: Error(Contract, #4)'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(true)));

        await expect(getCredentialFromChain('7')).resolves.toBeNull();
        expect(calls).toEqual([PRIMARY]);
    });

    it('never fails over on another contract error, and still fails closed', async () => {
        behaviours.set(PRIMARY, rpcError('HostError: Error(Contract, #40)'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));

        await expect(getCredentialFromChain('7')).rejects.toBeInstanceOf(BlockchainUnavailableError);
        expect(calls).toEqual([PRIMARY]);
    });

    it('throws BlockchainUnavailableError once every endpoint failed, naming none of their URLs', async () => {
        behaviours.set(PRIMARY, { kind: 'hang' });
        behaviours.set(FALLBACK_1, reject('socket hang up'));
        behaviours.set(FALLBACK_2, rpcError('503 Service Unavailable'));

        const error = await isRevokedFromChain('7').catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BlockchainUnavailableError);
        const message = (error as Error).message;
        expect(message).toContain('primary');
        expect(message).toContain('fallback-1');
        expect(message).toContain('fallback-2');
        expect(message).not.toContain('s3cr3t');
        expect(message).not.toContain('rpc-fallback');
        expect(calls).toEqual([PRIMARY, FALLBACK_1, FALLBACK_2]);
    });

    it('skips a fallback that serves another network, and never trusts it again', async () => {
        behaviours.set(PRIMARY, reject('down'));
        networks.set(FALLBACK_1, 'Public Global Stellar Network ; September 2015');
        behaviours.set(FALLBACK_1, rpcError('HostError: Error(Contract, #4)')); // would say "not found"
        behaviours.set(FALLBACK_2, answer(xdr.ScVal.scvBool(true)));

        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(calls).toEqual([PRIMARY, FALLBACK_2]);

        calls.length = 0;
        networkChecks.length = 0;
        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(networkChecks).not.toContain(FALLBACK_1);
        expect(calls).not.toContain(FALLBACK_1);
    });

    it('treats a fallback whose network cannot be checked as failed, and checks it again later', async () => {
        behaviours.set(PRIMARY, reject('down'));
        networks.set(FALLBACK_1, new Error('timeout'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));
        behaviours.set(FALLBACK_2, answer(xdr.ScVal.scvBool(true)));

        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(calls).toEqual([PRIMARY, FALLBACK_2]);

        // Recovered: checked again, then used.
        networks.set(FALLBACK_1, PASSPHRASE);
        behaviours.set(FALLBACK_2, reject('down'));
        calls.length = 0;
        await expect(isRevokedFromChain('7')).resolves.toBe(false);
        expect(calls).toContain(FALLBACK_1);
    });

    it('checks a fallback\'s network once, not on every read', async () => {
        behaviours.set(PRIMARY, reject('down'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));

        await isRevokedFromChain('7');
        await isRevokedFromChain('8');
        expect(networkChecks).toEqual([FALLBACK_1]);
    });

    it('tries a recently failed endpoint last, then first again after the cooldown', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        behaviours.set(PRIMARY, reject('down'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));
        await isRevokedFromChain('7');

        // Within the cooldown the primary does not cost every read a timeout.
        calls.length = 0;
        behaviours.set(PRIMARY, answer(xdr.ScVal.scvBool(true)));
        await expect(isRevokedFromChain('7')).resolves.toBe(false);
        expect(calls).toEqual([FALLBACK_1]);

        vi.setSystemTime(Date.now() + RPC_ENDPOINT_COOLDOWN_MS + 1);
        calls.length = 0;
        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(calls).toEqual([PRIMARY]);
    });

    it('still tries an endpoint in cooldown as a last resort', async () => {
        behaviours.set(PRIMARY, reject('blip'));
        behaviours.set(FALLBACK_1, answer(xdr.ScVal.scvBool(false)));
        await isRevokedFromChain('7');

        // Now everything but the cooled-down primary is down, and it has recovered.
        behaviours.set(PRIMARY, answer(xdr.ScVal.scvBool(true)));
        behaviours.set(FALLBACK_1, reject('down'));
        behaviours.set(FALLBACK_2, reject('down'));
        calls.length = 0;
        await expect(isRevokedFromChain('7')).resolves.toBe(true);
        expect(calls).toEqual([FALLBACK_1, FALLBACK_2, PRIMARY]);
    });
});
