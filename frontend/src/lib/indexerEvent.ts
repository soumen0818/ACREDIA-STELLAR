import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Indexes the contract's typed events (#[contractevent], SDK defaults; see
 * contracts/src/lib.rs). The first topic is the event name in snake_case,
 * then the fields marked #[topic]; the data is a map keyed by field name, so
 * fields are read by name and a new data field does not break this.
 *
 * The index serves listings and search. Verification reads the contract
 * directly (review §3.11b), so nothing here can make a credential verify.
 */

type EventData = Record<string, unknown>;

function asEventData(value: unknown): EventData {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as EventData) : {};
}

function unixSecondsToIso(value: unknown): string | null {
    return value === undefined || value === null ? null : new Date(Number(value) * 1000).toISOString();
}

/**
 * Writes a row for a newly issued credential, if none exists yet.
 *
 * Insert-only: the issuing app writes the full row (the credential content,
 * document and share token live only there), and in either order the two
 * must not clobber each other. This used to upsert `metadata: {}` over the
 * app's row, erasing the credential's content. The app upserts on
 * `token_id`, so it completes a row written here first.
 */
async function indexIssuedCredential(
    event: rpc.Api.EventResponse,
    tokenId: string,
    data: EventData,
    supabase: SupabaseClient,
) {
    const student = String(data.student ?? '');
    const issuer = String(data.issuer ?? '');

    const { data: instData, error: institutionError } = await supabase
        .from('institutions')
        .select('id')
        .eq('wallet_address', issuer)
        .maybeSingle();
    if (institutionError) throw institutionError;

    const { data: stuData, error: studentError } = await supabase
        .from('students')
        .select('id')
        .eq('wallet_address', student)
        .maybeSingle();
    if (studentError) throw studentError;

    const { error } = await supabase.from('credentials').upsert(
        {
            token_id: tokenId,
            student_id: stuData?.id || null,
            student_wallet_address: student,
            institution_id: instData?.id || null,
            issuer_wallet_address: issuer,
            // The issuance transaction, as the app stores it.
            blockchain_hash: event.txHash,
            // Content is unknown to the index; the share page reports it as
            // unverifiable until the app's row arrives.
            metadata: {},
            issued_at: new Date(event.ledgerClosedAt).toISOString(),
            expires_at: unixSecondsToIso(data.expires_at),
            revoked: false,
        },
        { onConflict: 'token_id', ignoreDuplicates: true },
    );
    if (error) throw error;
}

async function indexRevocation(
    event: rpc.Api.EventResponse,
    tokenId: string,
    source: 'issuer' | 'platform',
    supabase: SupabaseClient,
) {
    const { error, count } = await supabase
        .from('credentials')
        .update(
            {
                revoked: true,
                revoked_at: new Date(event.ledgerClosedAt).toISOString(),
                revocation_source: source,
            },
            { count: 'exact' },
        )
        .eq('token_id', tokenId);

    if (error) throw error;
    // Throwing keeps the cursor from advancing past a revocation it could
    // not record.
    if (count === 0) {
        throw new Error(
            `Credential ${tokenId} missing from index for ${source === 'issuer' ? 'issuer' : 'owner'} revocation`,
        );
    }
}

async function indexIssuerAuthorization(issuer: string, authorized: boolean, supabase: SupabaseClient) {
    const { error } = await supabase
        .from('institutions')
        .update(authorized ? { verified: true, status: 'verified' } : { verified: false, status: 'suspended' })
        .eq('wallet_address', issuer);
    if (error) throw error;
}

export async function processEvent(event: rpc.Api.EventResponse, supabase: SupabaseClient) {
    // The getEvents filter already restricts results to our contract, so we only
    // need to guard the event kind here.
    if (event.type !== 'contract') return;

    // Since @stellar/stellar-sdk v15, getEvents already decodes topic/value to
    // xdr.ScVal — pass them straight to scValToNative (no base64 fromXDR).
    const topics = event.topic.map((val) => scValToNative(val));
    const eventName = String(topics[0] ?? '');
    const subject = topics[1] === undefined ? '' : String(topics[1]);
    const data = asEventData(scValToNative(event.value));

    switch (eventName) {
        case 'credential_issued':
            return indexIssuedCredential(event, subject, data, supabase);
        case 'credential_revoked':
            return indexRevocation(event, subject, 'issuer', supabase);
        case 'credential_revoked_by_owner':
            return indexRevocation(event, subject, 'platform', supabase);
        case 'issuer_authorized':
            return indexIssuerAuthorization(subject, true, supabase);
        case 'issuer_revoked':
            return indexIssuerAuthorization(subject, false, supabase);
        default:
            // Other events (batch summaries, ownership, upgrades, pause) are
            // not indexed; batch rows arrive as individual credential_issued.
            return;
    }
}
