import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { executeLedgerOperation } from '../src/lib/ledgerGateway';
import { createE2eSigner } from '../src/lib/e2eLedger';
import { createKeypairSigner } from '../src/lib/stellarSigner';

afterEach(() => vi.unstubAllGlobals());

function seed() {
    const state = {
        enabled: true,
        contractOwner: 'owner',
        authorizedIssuers: ['issuer'],
        nextTokenId: 5,
    };
    vi.stubGlobal('window', { __ACREDIA_E2E__: state, sessionStorage: { setItem: vi.fn() } });
    return state;
}

describe('single ledger gateway', () => {
    it('routes all six operations to the fake ledger without running real execution', async () => {
        const state = seed();
        const real = vi.fn(async (): Promise<never> => {
            throw new Error('Unexpected RPC');
        });
        const owner = createE2eSigner('owner');
        const issuer = createE2eSigner('issuer');
        expect(await executeLedgerOperation('get_owner', [], undefined, real)).toBe('owner');
        expect(
            await executeLedgerOperation('is_authorized_issuer', ['stranger'], undefined, real),
        ).toBe(false);
        expect(await executeLedgerOperation('authorize_issuer', ['new-issuer'], owner, real)).toBe(
            'e2e-authorize-tx',
        );
        expect(state.authorizedIssuers).toContain('new-issuer');
        expect(await executeLedgerOperation('issue_credential', [], issuer, real)).toEqual({
            tokenId: '5',
            transactionHash: 'e2e-tx-5',
        });
        expect(await executeLedgerOperation('batch_issue_credential', [2], issuer, real)).toEqual({
            transactionHash: 'e2e-batch-tx-6',
            results: [
                { index: 0, success: true, tokenId: '6', errorCode: null },
                { index: 1, success: true, tokenId: '7', errorCode: null },
            ],
        });
        expect(await executeLedgerOperation('revoke_credential', ['5'], issuer, real)).toBe(
            'e2e-revoke-5',
        );
        expect(state.nextTokenId).toBe(8);
        expect(real).not.toHaveBeenCalled();
    });

    it('does not divert a real signer even when test state exists', async () => {
        seed();
        const real = vi.fn(async () => 'real-transaction');
        expect(
            await executeLedgerOperation(
                'authorize_issuer',
                ['issuer'],
                createKeypairSigner(Keypair.random()),
                real,
            ),
        ).toBe('real-transaction');
        expect(real).toHaveBeenCalledOnce();
    });

    it('routes reads to RPC when test state is absent', async () => {
        const readOwner = vi.fn(async () => 'real-owner');
        const readIssuer = vi.fn(async () => false);
        expect(await executeLedgerOperation('get_owner', [], undefined, readOwner)).toBe(
            'real-owner',
        );
        expect(
            await executeLedgerOperation('is_authorized_issuer', ['issuer'], undefined, readIssuer),
        ).toBe(false);
        expect(readOwner).toHaveBeenCalledOnce();
        expect(readIssuer).toHaveBeenCalledOnce();
    });

    it('refuses fake writes after their state is removed', async () => {
        const real = vi.fn(async () => 'unexpected');
        await expect(
            executeLedgerOperation('authorize_issuer', ['issuer'], createE2eSigner('owner'), real),
        ).rejects.toThrow(/nothing to act on/i);
        await expect(
            executeLedgerOperation('revoke_credential', ['1'], createE2eSigner('issuer'), real),
        ).rejects.toThrow(/nothing to act on/i);
        expect(real).not.toHaveBeenCalled();
    });

    it('enforces issuer and owner authorization at the fake boundary', async () => {
        seed();
        const real = vi.fn(async (): Promise<never> => {
            throw new Error('Unexpected RPC');
        });
        await expect(
            executeLedgerOperation('issue_credential', [], createE2eSigner('stranger'), real),
        ).rejects.toThrow(/not authorized/i);
        await expect(
            executeLedgerOperation(
                'authorize_issuer',
                ['stranger'],
                createE2eSigner('issuer'),
                real,
            ),
        ).rejects.toThrow(/Only the contract owner/);
        expect(real).not.toHaveBeenCalled();
    });
});
