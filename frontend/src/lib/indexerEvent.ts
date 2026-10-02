import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function processEvent(event: rpc.Api.EventResponse, supabase: SupabaseClient) {
    // The getEvents filter already restricts results to our contract, so we only
    // need to guard the event kind here.
    if (event.type !== 'contract') return;

    // In @stellar/stellar-sdk v15, getEvents already decodes topic/value to
    // xdr.ScVal — pass them straight to scValToNative (no base64 fromXDR).
    const topics = event.topic.map((val) => scValToNative(val));
    const eventName = topics[0]?.toString();
    const data = scValToNative(event.value);


    if (eventName === 'cred_iss') {
        const tokenId = topics[1]?.toString();
        // Data is (student, issuer, credential_hash, ipfs_uri)
        const student = data[0]?.toString();
        const issuer = data[1]?.toString();
        const credentialHash = bytesToHex(data[2]);
        const ipfsUri = data[3]?.toString();
        // ipfsUri is 'ipfs://<hash>'
        const ipfsHash = ipfsUri?.replace('ipfs://', '') || '';

        // Ensure institution exists (or we just map by wallet_address)
        const { data: instData, error: institutionError } = await supabase
            .from('institutions')
            .select('id')
            .eq('wallet_address', issuer)
            .maybeSingle();
        if (institutionError) throw institutionError;

        const institutionId = instData?.id || null;

        // Ensure student exists
        const { data: stuData, error: studentError } = await supabase
            .from('students')
            .select('id')
            .eq('wallet_address', student)
            .maybeSingle();
        if (studentError) throw studentError;

        const studentId = stuData?.id || null;

        const { error } = await supabase.from('credentials').upsert(
            {
                token_id: tokenId,
                student_id: studentId,
                student_wallet_address: student,
                institution_id: institutionId,
                issuer_wallet_address: issuer,
                ipfs_hash: ipfsHash,
                blockchain_hash: credentialHash,
                metadata: {}, // Empty for indexed-only ones if not known
                issued_at: new Date(event.ledgerClosedAt).toISOString(),
                revoked: false,
            },
            { onConflict: 'token_id' },
        );

        if (error) throw error;
    } else if (eventName === 'cred_rev') {
        const tokenId = topics[1]?.toString();
        const { error, count } = await supabase
            .from('credentials')
            .update(
                {
                    revoked: true,
                    revoked_at: new Date(event.ledgerClosedAt).toISOString(),
                    revocation_source: 'issuer',
                },
                { count: 'exact' },
            )
            .eq('token_id', tokenId);

        if (error) throw error;
        if (count === 0)
            throw new Error(`Credential ${tokenId} missing from index for issuer revocation`);
    } else if (eventName === 'cred_rev_owner') {
        const tokenId = topics[1]?.toString();
        const { error, count } = await supabase
            .from('credentials')
            .update(
                {
                    revoked: true,
                    revoked_at: new Date(event.ledgerClosedAt).toISOString(),
                    revocation_source: 'platform',
                },
                { count: 'exact' },
            )
            .eq('token_id', tokenId);

        if (error) throw error;
        if (count === 0)
            throw new Error(`Credential ${tokenId} missing from index for owner revocation`);
    } else if (eventName === 'iss_auth') {
        const issuer = data?.toString();
        const { error } = await supabase
            .from('institutions')
            .update({ verified: true, status: 'verified' })
            .eq('wallet_address', issuer);

        if (error) throw error;
    } else if (eventName === 'iss_rev') {
        const issuer = data?.toString();
        const { error } = await supabase
            .from('institutions')
            .update({ verified: false, status: 'suspended' })
            .eq('wallet_address', issuer);

        if (error) throw error;
    }
}
