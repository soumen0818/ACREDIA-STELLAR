import { Address, Keypair, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { processEvent } from '../src/lib/indexerEvent';

/**
 * The indexer reads the contract's typed events (review §3.11c). Events here
 * have exactly the shape the contract emits, as recorded in
 * contracts/test_snapshots: topics `[symbol name, #[topic] field]`, data a
 * map keyed by field name, `void` for `None`.
 */

const STUDENT = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

function symbol(name: string) {
    return xdr.ScVal.scvSymbol(name);
}

/** A map with symbol keys, sorted by key as Soroban stores it. */
function dataMap(fields: Record<string, xdr.ScVal>) {
    return xdr.ScVal.scvMap(
        Object.keys(fields)
            .sort()
            .map((key) => new xdr.ScMapEntry({ key: symbol(key), val: fields[key] })),
    );
}

function contractEvent(topic: xdr.ScVal[], value: xdr.ScVal) {
    return {
        type: 'contract',
        topic,
        value,
        ledger: 123,
        ledgerClosedAt: '2026-10-02T00:00:00Z',
        txHash: 'tx-hash-of-issuance',
    } as unknown as rpc.Api.EventResponse;
}

function credentialIssued(expiresAt: bigint | null) {
    return contractEvent(
        [symbol('credential_issued'), nativeToScVal(BigInt(42), { type: 'u64' })],
        dataMap({
            student: new Address(STUDENT).toScVal(),
            issuer: new Address(ISSUER).toScVal(),
            credential_hash: xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
            expires_at: expiresAt === null ? xdr.ScVal.scvVoid() : nativeToScVal(expiresAt, { type: 'u64' }),
        }),
    );
}

function revocation(name: string, actor: string) {
    return contractEvent(
        [symbol(name), nativeToScVal(BigInt(42), { type: 'u64' })],
        dataMap({ [actor]: new Address(ISSUER).toScVal() }),
    );
}

function issuerEvent(name: string) {
    return contractEvent([symbol(name), new Address(ISSUER).toScVal()], dataMap({}));
}

/** A Supabase stand-in that records every write. */
function database(options: { updateCount?: number; error?: Error | null } = {}) {
    const upsert = vi.fn(async (_row: unknown, _options?: unknown) => ({ error: options.error ?? null }));
    const updateEq = vi.fn(async () => ({ count: options.updateCount ?? 1, error: options.error ?? null }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const lookups: Array<[string, string, unknown]> = [];
    const from = vi.fn((table: string) => ({
        select: () => ({
            eq: (column: string, value: unknown) => {
                lookups.push([table, column, value]);
                return {
                    maybeSingle: async () => ({
                        data: { id: table === 'institutions' ? 'inst-1' : 'student-1' },
                        error: null,
                    }),
                };
            },
        }),
        upsert,
        update,
    }));
    return { client: { from } as unknown as SupabaseClient, from, upsert, update, updateEq, lookups };
}

describe('indexer: credential_issued', () => {
    it('inserts a status-only row, linked to the institution and student', async () => {
        const db = database();
        await processEvent(credentialIssued(BigInt(Date.UTC(2100, 0, 1) / 1000)), db.client);

        expect(db.lookups).toEqual([
            ['institutions', 'wallet_address', ISSUER],
            ['students', 'wallet_address', STUDENT],
        ]);
        expect(db.upsert).toHaveBeenCalledWith(
            {
                token_id: '42',
                student_id: 'student-1',
                student_wallet_address: STUDENT,
                institution_id: 'inst-1',
                issuer_wallet_address: ISSUER,
                blockchain_hash: 'tx-hash-of-issuance',
                metadata: {},
                issued_at: '2026-10-02T00:00:00.000Z',
                expires_at: '2100-01-01T00:00:00.000Z',
                revoked: false,
            },
            // Never overwrites the issuing app's row, which holds the content.
            { onConflict: 'token_id', ignoreDuplicates: true },
        );
    });

    it('records a credential without expiry as never expiring', async () => {
        const db = database();
        await processEvent(credentialIssued(null), db.client);
        expect(db.upsert.mock.calls[0][0]).toMatchObject({ expires_at: null });
    });

    it('propagates database errors so the event is retried', async () => {
        const db = database({ error: new Error('database unavailable') });
        await expect(processEvent(credentialIssued(null), db.client)).rejects.toThrow(
            'database unavailable',
        );
    });
});

describe('indexer: revocation events', () => {
    it.each([
        ['credential_revoked', 'issuer', 'issuer'],
        ['credential_revoked_by_owner', 'owner', 'platform'],
    ])('records %s as %s-revoked by %s', async (name, actor, source) => {
        const db = database();
        await processEvent(revocation(name, actor), db.client);
        expect(db.update).toHaveBeenCalledWith(
            {
                revoked: true,
                revocation_source: source,
                revoked_at: '2026-10-02T00:00:00.000Z',
            },
            { count: 'exact' },
        );
        expect(db.updateEq).toHaveBeenCalledWith('token_id', '42');
    });

    it('rejects a missing credential so the cursor cannot advance past a revocation', async () => {
        const db = database({ updateCount: 0 });
        await expect(
            processEvent(revocation('credential_revoked_by_owner', 'owner'), db.client),
        ).rejects.toThrow('missing from index');
    });

    it('propagates database errors so the event is retried', async () => {
        const db = database({ updateCount: 0, error: new Error('database unavailable') });
        await expect(processEvent(revocation('credential_revoked', 'issuer'), db.client)).rejects.toThrow(
            'database unavailable',
        );
    });
});

describe('indexer: issuer events', () => {
    it.each([
        ['issuer_authorized', { verified: true, status: 'verified' }],
        ['issuer_revoked', { verified: false, status: 'suspended' }],
    ])('applies %s to the institution with that wallet', async (name, change) => {
        const db = database();
        await processEvent(issuerEvent(name), db.client);
        expect(db.from).toHaveBeenCalledWith('institutions');
        expect(db.update).toHaveBeenCalledWith(change);
        expect(db.updateEq).toHaveBeenCalledWith('wallet_address', ISSUER);
    });
});

describe('indexer: other events', () => {
    it.each([
        // Summaries: each batch row also emits credential_issued.
        ['batch_issued', contractEvent([symbol('batch_issued'), new Address(ISSUER).toScVal()], dataMap({}))],
        ['paused', contractEvent([symbol('paused')], dataMap({}))],
        // The previous contract's names; nothing emits them any more.
        ['cred_iss', contractEvent([symbol('cred_iss'), nativeToScVal(BigInt(1), { type: 'u64' })], dataMap({}))],
    ])('ignores %s', async (_name, event) => {
        const db = database();
        await processEvent(event, db.client);
        expect(db.from).not.toHaveBeenCalled();
    });
});
