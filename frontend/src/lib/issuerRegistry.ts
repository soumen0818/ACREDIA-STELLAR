import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captureException } from './debug';
import { runtimeConfig } from './runtimeConfig';

/**
 * The public issuer trust registry (Issue #171): verified institutions, with
 * public, non-personal columns only. Read by GET /api/issuers and rendered
 * into the /issuers page (review §4.5).
 */

export interface PublicIssuer {
    id: string;
    name: string;
    wallet_address: string | null;
    authorization_tx_hash: string | null;
    /** ISO timestamp (created_at of the institution row). */
    verified_at: string;
}

interface IssuerRow {
    id: string;
    name: string;
    wallet_address: string | null;
    authorization_tx_hash: string | null;
    created_at: string;
}

/** How long the /issuers page reuses a fetched list, matching the API's max-age. */
export const ISSUER_REGISTRY_REVALIDATE_SECONDS = 300;

/**
 * Verified institutions, newest first. Throws on a database error.
 *
 * email is never selected (PII); name and wallet are public business
 * identifiers.
 */
export async function fetchVerifiedIssuers(client: SupabaseClient): Promise<PublicIssuer[]> {
    const { data, error } = await client
        .from('institutions')
        .select('id, name, wallet_address, authorization_tx_hash, created_at')
        .eq('verified', true)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return ((data ?? []) as IssuerRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        wallet_address: row.wallet_address,
        authorization_tx_hash: row.authorization_tx_hash,
        verified_at: row.created_at,
    }));
}

/** An anon-key client: the registry is public data under RLS. */
export function createRegistryClient(fetchImpl?: typeof fetch): SupabaseClient | null {
    const { url, anonKey } = runtimeConfig.supabase;
    if (!url || !anonKey) return null;

    return createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
    });
}

/**
 * The registry for server-rendering /issuers, or null if it cannot be read
 * right now; the page then loads it in the browser from /api/issuers.
 *
 * Cached for ISSUER_REGISTRY_REVALIDATE_SECONDS, so page views do not each
 * query the database, and bounded by a timeout, so a slow database delays the
 * page by seconds at most.
 */
export async function loadVerifiedIssuersForPage(): Promise<PublicIssuer[] | null> {
    const client = createRegistryClient((input, init) =>
        fetch(input, {
            ...init,
            signal: AbortSignal.timeout(3_000),
            next: { revalidate: ISSUER_REGISTRY_REVALIDATE_SECONDS },
        }),
    );
    if (!client) return null;

    try {
        return await fetchVerifiedIssuers(client);
    } catch (error) {
        captureException(error, { context: 'issuers page: server-rendered registry' });
        return null;
    }
}
