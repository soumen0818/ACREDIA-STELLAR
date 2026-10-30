/* eslint-disable @typescript-eslint/no-explicit-any */
import { Address, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { verifyAdminAuthorizationTransaction } from '../src/lib/adminAuthorizationVerification';

const walletAddress = Keypair.random().publicKey();
const otherWalletAddress = Keypair.random().publicKey();
const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
const otherContractId = StrKey.encodeContract(Buffer.alloc(32, 8));
const transactionHash = 'a'.repeat(64);

function fakeServer(transaction: unknown) {
    return {
        getTransaction: vi.fn(async () => transaction),
        simulateTransaction: vi.fn(),
    } as any;
}

// The contract's `issuer_authorized` event: the issuer is a topic and the
// data an empty map (contracts/test_snapshots record this shape).
function authEvent(wallet = walletAddress, contract = contractId) {
    return {
        contractId: contract,
        topics: ['issuer_authorized', wallet],
        data: {},
    } as any;
}

function xdrAuthEvent(wallet = walletAddress, contract = contractId, name = 'issuer_authorized') {
    const contractBytes = StrKey.decodeContract(contract);
    const body = new xdr.ContractEventV0({
        topics: [xdr.ScVal.scvSymbol(name), new Address(wallet).toScVal()],
        data: xdr.ScVal.scvMap([]),
    });

    return new xdr.ContractEvent({
        ext: xdr.ExtensionPoint.v0(),
        contractId: new xdr.ContractId(contractBytes),
        type: xdr.ContractEventType.contract,
        body: xdr.ContractEventBody.v0(body),
    }) as any;
}

function successTransaction(event = authEvent()) {
    return {
        status: 'SUCCESS',
        events: {
            contractEventsXdr: [[event]],
        },
    };
}

describe('admin authorization transaction verification', () => {
    it('accepts a successful authorize_issuer transaction for the submitted wallet and contract', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction()),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toEqual({
            ok: true,
            walletAddress,
            transactionHash,
            contractId,
        });
    });

    it('accepts actual Stellar XDR contract events returned by RPC', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(xdrAuthEvent())),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({
            ok: true,
            walletAddress,
            transactionHash,
            contractId,
        });
    });

    it('no longer accepts the previous contract’s iss_auth event', async () => {
        const oldEvent = new xdr.ContractEvent({
            ext: xdr.ExtensionPoint.v0(),
            contractId: new xdr.ContractId(StrKey.decodeContract(contractId)),
            type: xdr.ContractEventType.contract,
            body: xdr.ContractEventBody.v0(
                new xdr.ContractEventV0({
                    topics: [xdr.ScVal.scvSymbol('iss_auth')],
                    data: new Address(walletAddress).toScVal(),
                }),
            ),
        }) as any;

        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(oldEvent)),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-contract' });
    });

    it('rejects an issuer_authorized event for a different wallet in XDR form', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(xdrAuthEvent(otherWalletAddress))),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-wallet' });
    });

    it('rejects invalid wallet addresses before fetching Stellar RPC', async () => {
        const server = fakeServer(successTransaction());

        const result = await verifyAdminAuthorizationTransaction('not-a-wallet', transactionHash, {
            contractId,
            server,
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'invalid-wallet', status: 400 });
        expect(server.getTransaction).not.toHaveBeenCalled();
    });

    it('rejects invalid transaction hash formats before fetching Stellar RPC', async () => {
        const server = fakeServer(successTransaction());

        const result = await verifyAdminAuthorizationTransaction(walletAddress, 'not-a-hash', {
            contractId,
            server,
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'invalid-transaction-hash', status: 400 });
        expect(server.getTransaction).not.toHaveBeenCalled();
    });

    it('returns a wrong-network state when the transaction is not found on configured RPC', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer({ status: 'NOT_FOUND' }),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-network', status: 409 });
    });

    it('returns a pending state when the transaction has not finalized', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer({ status: 'PENDING' }),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'pending', status: 409 });
    });

    it('rejects failed authorization transactions', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer({ status: 'FAILED' }),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'failed', status: 422 });
    });

    it('rejects successful transactions that authorized a different wallet', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(authEvent(otherWalletAddress))),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-wallet', status: 422 });
    });

    it('rejects successful authorization events from a different contract', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(authEvent(walletAddress, otherContractId))),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-contract', status: 422 });
    });

    it('rejects actual XDR authorization events from a different contract', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction(xdrAuthEvent(walletAddress, otherContractId))),
            isAuthorizedIssuerOnChain: vi.fn(async () => true),
        });

        expect(result).toMatchObject({ ok: false, code: 'wrong-contract', status: 422 });
    });

    it('rejects transactions when the current contract state does not authorize the wallet', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction()),
            isAuthorizedIssuerOnChain: vi.fn(async () => false),
        });

        expect(result).toMatchObject({ ok: false, code: 'not-authorized', status: 422 });
    });

    it('returns rpc-unavailable when current authorization state cannot be confirmed', async () => {
        const result = await verifyAdminAuthorizationTransaction(walletAddress, transactionHash, {
            contractId,
            server: fakeServer(successTransaction()),
            isAuthorizedIssuerOnChain: vi.fn(async () => {
                throw new Error('rpc unavailable');
            }),
        });

        expect(result).toMatchObject({ ok: false, code: 'rpc-unavailable', status: 503 });
    });
});
