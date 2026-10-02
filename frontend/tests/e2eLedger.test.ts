import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { E2eState } from '../src/lib/e2e';
import {
    createE2eSigner,
    e2eLedgerReads,
    e2eLedgerWrites,
    isAuthorizedInE2eState,
    isE2eSigner,
} from '../src/lib/e2eLedger';
import { createKeypairSigner } from '../src/lib/stellarSigner';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * The single E2E seam that replaced six inline forks (ACREDIA-STELLAR#3).
 *
 * `contracts.ts` carried a `getE2eState()` early return inside every exported
 * function. Each re-implemented the rule it was bypassing — authorization,
 * token-id sequencing — so the fake ledger and the real one were two
 * independent implementations that could disagree. These tests pin the
 * consolidated behaviour, and the last block asserts the forks are actually
 * gone rather than merely moved.
 */

const OWNER = 'GAcrediaAdminWallet00000000000000000000000000000001';
const ISSUER = 'GAcrediaIssuerWallet0000000000000000000000000000001';
const STRANGER = 'GAcrediaStrangerWallet00000000000000000000000000001';

function seedState(overrides: Partial<E2eState> = {}): E2eState {
    const state: E2eState = {
        enabled: true,
        contractOwner: OWNER,
        authorizedIssuers: [ISSUER],
        nextTokenId: 1,
        ...overrides,
    };

    vi.stubGlobal('window', {
        __ACREDIA_E2E__: state,
        sessionStorage: { setItem: vi.fn() },
    });

    return state;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isAuthorizedInE2eState', () => {
    it('authorizes a listed issuer and the contract owner', () => {
        const state = seedState();

        expect(isAuthorizedInE2eState(state, ISSUER)).toBe(true);
        // The owner is implicitly authorized, matching AcrediaCredential's rule.
        expect(isAuthorizedInE2eState(state, OWNER)).toBe(true);
    });

    it('refuses an unlisted wallet', () => {
        expect(isAuthorizedInE2eState(seedState(), STRANGER)).toBe(false);
    });

    it('ignores address casing', () => {
        // Fixtures are hand-written; a casing mismatch here would look like an
        // authorization bug rather than a typo.
        const state = seedState();
        expect(isAuthorizedInE2eState(state, ISSUER.toLowerCase())).toBe(true);
        expect(isAuthorizedInE2eState(state, OWNER.toUpperCase())).toBe(true);
    });

    it('handles state with no issuer list at all', () => {
        const state = seedState({ authorizedIssuers: undefined, contractOwner: undefined });
        expect(isAuthorizedInE2eState(state, ISSUER)).toBe(false);
    });
});

describe('isE2eSigner', () => {
    it('recognises the fake and rejects a real signer', () => {
        expect(isE2eSigner(createE2eSigner(ISSUER))).toBe(true);
        expect(isE2eSigner(createKeypairSigner(Keypair.random()))).toBe(false);
    });

    it('is not fooled by a plain object claiming to be one', () => {
        // The marker is a registered Symbol, so it cannot be spelled by
        // accident in a fixture or a JSON round-trip.
        expect(isE2eSigner({ address: ISSUER, signTransaction: async () => '' })).toBe(false);
        expect(
            isE2eSigner({
                address: ISSUER,
                signTransaction: async () => '',
                e2e: true,
            } as never),
        ).toBe(false);
    });
});

describe('createE2eSigner', () => {
    it('throws if anything actually tries to sign with it', async () => {
        // Reaching a signature means a contract function lost its isE2eSigner
        // guard and would otherwise have talked to a real ledger.
        const signer = createE2eSigner(ISSUER);

        await expect(
            signer.signTransaction('AAAA', { networkPassphrase: 'Test SDF Network ; September 2015' }),
        ).rejects.toThrow(/asked to sign a real transaction/i);
    });

    it('signs messages, since the claim flow needs a value it can post', async () => {
        const signer = createE2eSigner(ISSUER);
        const signature = await signer.signMessage!('hello', { networkPassphrase: 'x' });

        expect(Buffer.from(signature, 'base64').toString()).toBe('e2e-signature:hello');
    });
});

describe('e2eLedgerReads', () => {
    it('returns null when E2E is not driving, so callers fall through', () => {
        // Null rather than a value: the real ledger must be consulted when the
        // suite is not running, and a falsy answer would be ambiguous.
        vi.stubGlobal('window', { __ACREDIA_E2E__: undefined });
        expect(e2eLedgerReads.contractOwner()).toBeNull();
        expect(e2eLedgerReads.isAuthorizedIssuer(ISSUER)).toBeNull();
    });

    it('distinguishes "E2E says not authorized" from "E2E is off"', () => {
        seedState();
        expect(e2eLedgerReads.isAuthorizedIssuer(STRANGER)).toBe(false);
        expect(e2eLedgerReads.isAuthorizedIssuer(ISSUER)).toBe(true);
    });

    it('serves the seeded contract owner', () => {
        seedState();
        expect(e2eLedgerReads.contractOwner()).toBe(OWNER);
    });
});

describe('e2eLedgerWrites', () => {
    it('records an authorization and keeps the stats count in step', () => {
        const state = seedState({
            authorizedIssuers: [],
            stats: { authorizedInstitutions: 0 } as never,
        });

        expect(e2eLedgerWrites.authorizeIssuer(OWNER, ISSUER)).toBe('e2e-authorize-tx');
        expect(state.authorizedIssuers).toEqual([ISSUER]);
        expect(state.stats?.authorizedInstitutions).toBe(1);
    });

    it('does not double-list an already authorized issuer', () => {
        const state = seedState();
        e2eLedgerWrites.authorizeIssuer(OWNER, ISSUER);
        expect(state.authorizedIssuers).toEqual([ISSUER]);
    });

    it('issues sequential token ids', () => {
        const state = seedState({ nextTokenId: 5 });

        expect(e2eLedgerWrites.issueCredential(ISSUER)).toEqual({
            tokenId: '5',
            transactionHash: 'e2e-tx-5',
        });
        expect(state.nextTokenId).toBe(6);
    });

    it('refuses issuance from an unauthorized wallet', () => {
        // The browser suite asserts on this path, so the fake has to enforce
        // the rule rather than wave every caller through.
        seedState();
        expect(() => e2eLedgerWrites.issueCredential(STRANGER)).toThrow(/not authorized/i);
    });

    it('reserves a contiguous id range for a batch', () => {
        const state = seedState({ nextTokenId: 10 });

        expect(e2eLedgerWrites.batchIssueCredential(ISSUER, 3)).toEqual({
            transactionHash: 'e2e-batch-tx-10',
            startTokenId: 10,
        });
        expect(state.nextTokenId).toBe(13);
    });

    it('refuses a batch from an unauthorized wallet', () => {
        seedState();
        expect(() => e2eLedgerWrites.batchIssueCredential(STRANGER, 2)).toThrow(/not authorized/i);
    });

    it('fails loudly if the fake outlives its state', () => {
        vi.stubGlobal('window', { __ACREDIA_E2E__: undefined });
        expect(() => e2eLedgerWrites.issueCredential(ISSUER)).toThrow(/nothing to act on/i);
    });
});

describe('contracts.ts decoupling', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'contracts.ts'), 'utf8');

    it('imports no wallet SDK', () => {
        // The acceptance criterion this issue turns on. Transaction
        // construction and wallet identity are separate concerns again.
        expect(source).not.toMatch(/@stellar\/freighter-api/);
        expect(source).not.toMatch(/@creit\.tech\/stellar-wallets-kit/);
        expect(source).not.toMatch(/from '\.\/wallet'/);
    });

    it('reads E2E state through the seam rather than inline', () => {
        // Six `getE2eState()` early returns became zero: the signer decides.
        expect(source).not.toMatch(/getE2eState/);
        expect(source).not.toMatch(/updateE2eState/);
        expect(source).toMatch(/from '\.\/ledgerGateway'/);
        expect(source).not.toMatch(/isE2eSigner|e2eLedgerReads|e2eLedgerWrites/);
    });

    it('takes signers on every writing function', () => {
        for (const signature of [
            /export async function authorizeIssuer\(\s*admin: StellarSigner/,
            /issuer: StellarSigner,\s*\): Promise<\{ tokenId: string; transactionHash: string \}>/,
            /export async function batchIssueCredentialOnStellar\([\s\S]*?issuer: StellarSigner/,
            /export async function revokeCredentialOnStellar\(\s*tokenId: string,\s*issuer: StellarSigner/,
        ]) {
            expect(source).toMatch(signature);
        }
    });

    it('keeps read-only functions on plain addresses', () => {
        // A signer here would be a dependency the verify API route — which has
        // no wallet — could not satisfy.
        expect(source).toMatch(/export async function getContractOwner\(callerAddress: string\)/);
        expect(source).toMatch(/export async function isAuthorizedIssuer\(\s*issuerAddress: string/);
    });
});
