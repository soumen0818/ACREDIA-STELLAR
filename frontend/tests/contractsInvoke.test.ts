import { Account, Keypair, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `invokeContractMethod` under unit test, with no browser and no wallet
 * extension (ACREDIA-STELLAR#3).
 *
 * This was previously untestable: the function imported `signTransaction` from
 * `@stellar/freighter-api` at module scope, so reaching it meant stubbing a
 * browser extension. `contracts.test.ts` could only cover the pure helpers
 * around it, which left the build → simulate → sign → submit → confirm sequence
 * — the part that actually moves credentials on-chain — unexercised.
 *
 * With a signer as a parameter, a keypair signs locally and the RPC server is
 * the only thing that needs stubbing.
 */

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CONTRACT_ID = 'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK';

const issuerKeypair = Keypair.random();

/** A stub Soroban RPC server recording what it was asked to do. */
function createRpcStub() {
    const account = new Account(issuerKeypair.publicKey(), '1');

    return {
        getAccount: vi.fn(async () => account),
        simulateTransaction: vi.fn(async () => ({ result: { retval: null } })),

        // `prepareTransaction` normally returns a transaction with the Soroban
        // footprint attached. Returning the input unchanged is enough: this
        // test cares about who signs it and what gets submitted.
        prepareTransaction: vi.fn(async (tx: unknown) => tx),

        sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'stub-tx-hash' })),
        getTransaction: vi.fn(async () => ({
            status: 'SUCCESS',
            returnValue: nativeToScVal(7, { type: 'u64' }),
        })),
    };
}

let rpc: ReturnType<typeof createRpcStub>;

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    rpc = createRpcStub();

    // `stellar.ts` builds an `rpc.Server` at module scope against a real URL,
    // so it is mocked rather than imported.
    vi.doMock('../src/lib/stellar', () => ({
        sorobanServer: rpc,
        activeNetwork: {
            networkPassphrase: NETWORK_PASSPHRASE,
            networkName: 'testnet',
            kind: 'testnet',
        },
        getContractAddress: () => CONTRACT_ID,
    }));

    // Keeps the console quiet; `contracts.ts` logs confirmation progress.
    vi.doMock('../src/lib/debug', () => ({
        debugLog: vi.fn(),
        debugWarn: vi.fn(),
        captureException: vi.fn(),
        recordMetric: vi.fn(),
    }));
});

afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
});

async function loadContracts() {
    return import('../src/lib/contracts');
}

/**
 * Runs a call to completion.
 *
 * `waitForConfirmation` sleeps 1.5s between polls, so the fake timers have to
 * be advanced while the promise is in flight rather than awaited first.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(2_000);
    return promise;
}

describe('invokeContractMethod with a keypair signer', () => {
    it('builds, simulates, signs and submits without any wallet involved', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        const signer = createKeypairSigner(issuerKeypair);

        const result = await settle(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], signer),
        );

        expect(rpc.simulateTransaction).toHaveBeenCalledTimes(1);
        expect(rpc.prepareTransaction).toHaveBeenCalledTimes(1);
        expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
        expect(result.transactionHash).toBe('stub-tx-hash');
        // Decoded from the u64 the stubbed confirmation returned.
        expect(result.returnValue).toBe(BigInt(7));
    });

    it('sources the transaction from the signer’s own address', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');

        await settle(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], createKeypairSigner(issuerKeypair)),
        );

        // The address is no longer a separate parameter that could disagree
        // with whoever signs — it comes from the signer itself.
        expect(rpc.getAccount).toHaveBeenCalledWith(issuerKeypair.publicKey());
    });

    it('submits a transaction actually signed by that keypair', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');

        await settle(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], createKeypairSigner(issuerKeypair)),
        );

        // The whole point of the seam: verify the submitted transaction carries
        // a valid signature from the signer, not merely that submit was called.
        // `sendTransaction`'s stub takes no declared parameters, so the recorded
        // call is typed as an empty tuple; read it as unknown[] to inspect it.
        const [submitted] = rpc.sendTransaction.mock.calls[0] as unknown as [
            { signatures: Array<{ signature: { value: Uint8Array } }>; hash: () => Uint8Array },
        ];
        expect(submitted.signatures).toHaveLength(1);
        expect(
            issuerKeypair.verify(submitted.hash(), submitted.signatures[0].signature.value),
        ).toBe(true);
    });

    it('passes the app’s network passphrase to the signer', async () => {
        const { invokeContractMethod } = await loadContracts();
        const signer = {
            address: issuerKeypair.publicKey(),
            signTransaction: vi.fn(async (value: string) => {
                const tx = TransactionBuilder.fromXDR(value, NETWORK_PASSPHRASE);
                tx.sign(issuerKeypair);
                return tx.toXDR();
            }),
        };

        await settle(invokeContractMethod(CONTRACT_ID, 'issue_credential', [], signer));

        // Never a hardcoded network: a signer told the wrong passphrase
        // produces a signature bound to the wrong ledger.
        expect(signer.signTransaction).toHaveBeenCalledWith(expect.any(String), {
            networkPassphrase: NETWORK_PASSPHRASE,
        });
    });

    it('reports a cancelled signature as a cancellation, not a failure', async () => {
        const { invokeContractMethod } = await loadContracts();
        const signer = {
            address: issuerKeypair.publicKey(),
            // The message a wallet signer raises when the user dismisses the
            // prompt. `contracts.ts` matches on the message rather than on an
            // error class, precisely so it needs no wallet import.
            signTransaction: vi.fn(async () => {
                throw new Error('Transaction signing was canceled.');
            }),
        };

        await expect(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], signer),
        ).rejects.toThrow(/canceled by the user/i);

        expect(rpc.sendTransaction).not.toHaveBeenCalled();
    });

    it('surfaces a network mismatch with the expected network named', async () => {
        const { invokeContractMethod } = await loadContracts();
        const signer = {
            address: issuerKeypair.publicKey(),
            signTransaction: vi.fn(async () => {
                throw new Error('Wallet is on the wrong network');
            }),
        };

        await expect(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], signer),
        ).rejects.toThrow(/Network mismatch[\s\S]*testnet/);
    });

    it('names the signer’s address in the unauthorized-issuer message', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        rpc.simulateTransaction.mockResolvedValueOnce({
            error: 'HostError: Issuer not authorized',
        } as never);

        await expect(
            invokeContractMethod(
                CONTRACT_ID,
                'issue_credential',
                [],
                createKeypairSigner(issuerKeypair),
            ),
        ).rejects.toThrow(issuerKeypair.publicKey());
    });

    it.each([
        'HostError: Error(Contract, #10)',
        'HostError: Error(Contract, 10)\nEvent log (newest first): ...',
    ])('explains an emergency pause instead of a raw contract error (%s)', async (error) => {
        // ACREDIA-STELLAR#306: a paused contract is an operator decision, not a bug.
        const { invokeContractMethod, CONTRACT_PAUSED_MESSAGE } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        rpc.simulateTransaction.mockResolvedValueOnce({ error } as never);

        await expect(
            invokeContractMethod(CONTRACT_ID, 'issue_credential', [], createKeypairSigner(issuerKeypair)),
        ).rejects.toThrow(CONTRACT_PAUSED_MESSAGE);
        expect(rpc.sendTransaction).not.toHaveBeenCalled();
    });

    it('does not mistake other contract errors for a pause', async () => {
        const { invokeContractMethod, CONTRACT_PAUSED_MESSAGE } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        // #100 and #1 are different errors; only exactly #10 is ContractPaused.
        for (const error of ['HostError: Error(Contract, #100)', 'HostError: Error(Contract, #1)']) {
            rpc.simulateTransaction.mockResolvedValueOnce({ error } as never);
            const attempt = invokeContractMethod(CONTRACT_ID, 'issue_credential', [], createKeypairSigner(issuerKeypair));
            await expect(attempt).rejects.toThrow(/Simulation failed/);
            await expect(attempt).rejects.not.toThrow(CONTRACT_PAUSED_MESSAGE);
        }
    });

    it('does not submit when simulation fails', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        rpc.simulateTransaction.mockResolvedValueOnce({ error: 'boom' } as never);

        await expect(
            invokeContractMethod(
                CONTRACT_ID,
                'issue_credential',
                [],
                createKeypairSigner(issuerKeypair),
            ),
        ).rejects.toThrow(/Simulation failed/);

        expect(rpc.sendTransaction).not.toHaveBeenCalled();
    });

    it('raises a submission error rather than reporting a phantom success', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        rpc.sendTransaction.mockResolvedValueOnce({
            status: 'ERROR',
            hash: 'x',
            errorResult: { toXDR: () => 'error-xdr' },
        } as never);

        await expect(
            invokeContractMethod(
                CONTRACT_ID,
                'issue_credential',
                [],
                createKeypairSigner(issuerKeypair),
            ),
        ).rejects.toThrow(/Submission failed/);
    });

    it('fails when the transaction never confirms', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        rpc.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' } as never);

        const pending = invokeContractMethod(
            CONTRACT_ID,
            'issue_credential',
            [],
            createKeypairSigner(issuerKeypair),
        );
        const assertion = expect(pending).rejects.toThrow(/not confirmed after/);

        // 20 polls at 1.5s apart.
        await vi.advanceTimersByTimeAsync(40_000);
        await assertion;
    });

    it('passes contract arguments through to the built transaction', async () => {
        const { invokeContractMethod } = await loadContracts();
        const { createKeypairSigner } = await import('../src/lib/stellarSigner');
        const args = [nativeToScVal(42, { type: 'u64' })];

        await settle(
            invokeContractMethod(
                CONTRACT_ID,
                'revoke_credential',
                args,
                createKeypairSigner(issuerKeypair),
            ),
        );

        const [simulated] = rpc.simulateTransaction.mock.calls[0] as unknown as [
            { operations: Array<{ func?: unknown; parameters?: unknown }> },
        ];
        expect(simulated.operations).toHaveLength(1);

        // Reaching into the invoke-host-function operation confirms the method
        // name and argument survived transaction construction.
        const invokeArgs = (
            simulated.operations[0] as unknown as {
                func: { invokeContract: xdr.InvokeContractArgs };
            }
        ).func.invokeContract;
        expect(invokeArgs.functionName.toString()).toBe('revoke_credential');
        expect(invokeArgs.args).toHaveLength(1);
    });
});
