import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, contract, Keypair, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONTRACT_ID = vi.hoisted(() => ({ value: '' }));

vi.mock('../src/lib/runtimeConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/runtimeConfig')>();
    const { StrKey: keys } = await import('@stellar/stellar-sdk');
    CONTRACT_ID.value = keys.encodeContract(Buffer.alloc(32, 1));
    return {
        ...actual,
        runtimeConfig: {
            ...actual.runtimeConfig,
            contracts: { ...actual.runtimeConfig.contracts, CREDENTIAL_NFT: CONTRACT_ID.value },
        },
    };
});
import {
    BlockchainUnavailableError,
    getCredentialFromChain,
    isAuthorizedIssuerOnChain,
    isRevokedFromChain,
    normalizeOnChainCredential,
} from '../src/lib/contractReads';
import { credentialHashHexToBytes } from '../src/lib/credentialHashEncoding';

const hash = 'feca52dc50aee21c1942333a13873250b5bda373e09a4e2aff29b80a44a78545';
const ISSUER = Keypair.random().publicKey();

describe('contract read normalization', () => {
    it('maps the contract Credential struct to JSON-safe fields', () => {
        const normalized = normalizeOnChainCredential({
            token_id: BigInt(7),
            student: 'GSTUDENT',
            issuer: 'GISSUER',
            credential_hash: credentialHashHexToBytes(hash),
            issued_at: BigInt(1770000000),
            expires_at: BigInt(1900000000),
            revoked: false,
        });

        expect(normalized).toEqual({
            tokenId: '7',
            student: 'GSTUDENT',
            issuer: 'GISSUER',
            hash,
            issuedAt: 1770000000,
            expiresAt: 1900000000,
            revoked: false,
        });
        // The verification cache stores this with JSON.stringify, which
        // throws on a bigint.
        expect(() => JSON.stringify(normalized)).not.toThrow();
    });

    it('reads a missing expiry (Option::None) as never expiring', () => {
        expect(
            normalizeOnChainCredential({
                token_id: BigInt(8),
                student: 'GSTUDENT',
                issuer: 'GISSUER',
                credential_hash: credentialHashHexToBytes(hash),
                issued_at: BigInt(1770000000),
                expires_at: undefined,
                revoked: true,
            }),
        ).toMatchObject({ expiresAt: null, revoked: true });
    });

    it('accepts the Map form scValToNative can produce', () => {
        const record = new Map<string, unknown>([
            ['token_id', BigInt(9)],
            ['student', 'GSTUDENT'],
            ['issuer', 'GISSUER'],
            ['credential_hash', credentialHashHexToBytes(hash)],
            ['issued_at', BigInt(1)],
            ['revoked', false],
        ]);
        expect(normalizeOnChainCredential(record)).toMatchObject({ tokenId: '9', hash });
    });

    it('returns null when there is no credential hash', () => {
        expect(normalizeOnChainCredential({ student: 'GSTUDENT' })).toBeNull();
        expect(normalizeOnChainCredential(null)).toBeNull();
    });
});

describe('contract reads go to the chain only (review §3.11b)', () => {
    it('never consults the database', () => {
        // Verification used to read credentials rows first, so editing a row
        // could make a credential verify (review §2 correction).
        const source = readFileSync(join(process.cwd(), 'src/lib/contractReads.ts'), 'utf8');
        expect(source).not.toMatch(/serverAuth|supabase|getServiceRoleClient|\.from\('/);
    });

    it('no longer exports the database-first readers', async () => {
        const reads = await import('../src/lib/contractReads');
        for (const removed of ['getCredential', 'isRevoked', 'isAuthorizedIssuer', 'verifyCredentialByHash']) {
            expect(reads).not.toHaveProperty(removed);
        }
    });
});

describe('contract reads over RPC', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function simulateReturns(value: xdr.ScVal) {
        return vi
            .spyOn(rpc.Server.prototype, 'simulateTransaction')
            .mockResolvedValue({ result: { retval: value } } as never);
    }

    function simulateFails(error: string) {
        return vi
            .spyOn(rpc.Server.prototype, 'simulateTransaction')
            .mockResolvedValue({ error } as never);
    }

    /** The contract, method and arguments in the simulated transaction. */
    function invocation(spy: ReturnType<typeof simulateReturns>) {
        const tx = spy.mock.calls[0][0] as unknown as {
            source: string;
            operations: Array<{
                func: {
                    invokeContract: {
                        contractAddress: xdr.ScAddress;
                        functionName: string;
                        args: xdr.ScVal[];
                    };
                };
            }>;
        };
        const call = tx.operations[0].func.invokeContract;
        return {
            source: tx.source,
            contract: Address.fromScAddress(call.contractAddress).toString(),
            method: String(call.functionName),
            args: call.args.map((arg) => scValToNative(arg)),
        };
    }

    it('reads is_revoked for the token from the configured contract', async () => {
        const spy = simulateReturns(xdr.ScVal.scvBool(true));
        await expect(isRevokedFromChain('42')).resolves.toBe(true);
        expect(invocation(spy)).toEqual({
            // A G-address: the SDK rejects the contract's C-address as an
            // account, which broke every chain read before this fix.
            source: contract.NULL_ACCOUNT,
            contract: CONTRACT_ID.value,
            method: 'is_revoked',
            args: [BigInt(42)],
        });
    });

    it('fails closed when revocation cannot be read', async () => {
        // Answering "not revoked" during an outage would let a revoked
        // credential verify.
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockRejectedValue(new Error('timeout'));
        await expect(isRevokedFromChain('42')).rejects.toBeInstanceOf(BlockchainUnavailableError);

        vi.restoreAllMocks();
        simulateFails('HostError: Error(WasmVm, InvalidAction)');
        await expect(isRevokedFromChain('42')).rejects.toBeInstanceOf(BlockchainUnavailableError);
    });

    it('treats CredentialNotFound (contract error #4) as not found, not as an outage', async () => {
        // The RPC renders contract errors as `Error(Contract, #4)`. Matching
        // only `Error(Contract, 4)` turned every unknown token into a 503.
        simulateFails('HostError: Error(Contract, #4)\n\nEvent log (newest first): ...');
        await expect(getCredentialFromChain('42')).resolves.toBeNull();
    });

    it('does not mistake another contract error for not found', async () => {
        simulateFails('HostError: Error(Contract, #40)');
        await expect(getCredentialFromChain('42')).rejects.toBeInstanceOf(BlockchainUnavailableError);
    });

    it('asks is_authorized_issuer about the issuer address', async () => {
        const spy = simulateReturns(xdr.ScVal.scvBool(false));
        await expect(isAuthorizedIssuerOnChain(ISSUER)).resolves.toBe(false);
        expect(invocation(spy)).toMatchObject({ method: 'is_authorized_issuer', args: [ISSUER] });
    });

    it('fails closed when issuer authorization cannot be read', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockRejectedValue(new Error('timeout'));
        await expect(isAuthorizedIssuerOnChain(ISSUER)).rejects.toBeInstanceOf(
            BlockchainUnavailableError,
        );
    });
});
