import { nativeToScVal, rpc } from '@stellar/stellar-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { processEvent } from '../src/lib/indexerEvent';

function revocationEvent(name: string) {
    return {
        type: 'contract',
        topic: [nativeToScVal(name, { type: 'symbol' }), nativeToScVal(BigInt(42), { type: 'u64' })],
        value: nativeToScVal('GOWNER'),
        ledger: 123,
        ledgerClosedAt: '2026-10-02T00:00:00Z',
    } as unknown as rpc.Api.EventResponse;
}

function database(count: number, error: Error | null = null) {
    const eq = vi.fn(async () => ({ count, error }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    return { client: { from } as unknown as SupabaseClient, update, eq };
}

describe('indexer revocation events', () => {
    it.each([
        ['cred_rev_owner', 'platform'],
        ['cred_rev', 'issuer'],
    ])('records %s as %s', async (name, source) => {
        const db = database(1);
        await processEvent(revocationEvent(name), db.client);
        expect(db.update).toHaveBeenCalledWith(
            expect.objectContaining({
                revoked: true,
                revocation_source: source,
                revoked_at: '2026-10-02T00:00:00.000Z',
            }),
            { count: 'exact' },
        );
        expect(db.eq).toHaveBeenCalledWith('token_id', '42');
    });

    it('rejects a missing credential so the cursor cannot advance past a revocation', async () => {
        const db = database(0);
        await expect(processEvent(revocationEvent('cred_rev_owner'), db.client)).rejects.toThrow(
            'missing from index',
        );
    });

    it('propagates database errors so the event is retried', async () => {
        const db = database(0, new Error('database unavailable'));
        await expect(processEvent(revocationEvent('cred_rev'), db.client)).rejects.toThrow(
            'database unavailable',
        );
    });
});
