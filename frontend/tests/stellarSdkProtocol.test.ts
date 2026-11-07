import { xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

/**
 * The indexer and the TTL keeper start from `getLatestLedger`. When testnet
 * moved to protocol 30, @stellar/stellar-sdk 17.2.1 threw on it
 * ("LedgerHeader.scpValue.ext.v: unknown enum value 3") and both stopped.
 * The failure was in decoding the ledger header; this is the header from the
 * response testnet returned on 2026-11-07, so the SDK in use must keep
 * decoding it.
 */

const PROTOCOL_30_LATEST_LEDGER = {
    id: '8336d997c3bfcec3ff37540dec22f9d44d456f9f100072b2a84b804a252d401e',
    protocolVersion: 30,
    sequence: 5607375,
    closeTime: '1794060516',
    headerXdr:
        'AAAAHiAmFMJD2w9WRrjuO9+zbCMYBwWOGfq4PIH9wmEukM696EGV9/zZPAY9mvhtE5Xda6FW8wogJgyJsNOxouXHUE0AAAAAau8w5AAAAAAAAAADAAABobZW/fgAAAAAtV0Qsrt9KE7VwDpHpeG1kMkPV4NVRxzEUHu+ggTSPIsAAABADW8d2qTVnJ1tAvjme68kTRvVNQ8J89DAbu8Vcr5iXd4XIufA04U7ODl/2hJnYEkk2lP/ugHZ3puAouOiliBgDcUDTlJRQkBpbVl34er53rzrleYKwEvsrHUN/CjgSZj9mOttSVmpy73eq8sQYZ5Xr07F6/nVNYZklfk4giLmSF0AVY/PDeC2s6dkAAAAACzWPYCzBQAAAAAAAAAAAA5/8gAAAGQATEtAAAAAyM/duRl0zBXTrNO825lVzr7xPfcRRLtc0h3uB8b1f50OtHGPNZrUYqw6l4Y4iP9/fLaR6yQWZR/yZDT9i6jLDXpV6bYk0c4jSljPLfrHdo1GV6GkbcUe+VrzZ2M+b8Liy0TAaAz0AcKXg+0YuEt37ZCofX9OhI4/zMdPViWaDD1oAAAAAA==',
};

describe('Stellar SDK against protocol 30', () => {
    it('decodes the ledger header testnet returns from getLatestLedger', () => {
        const header = xdr.LedgerHeader.fromXDR(PROTOCOL_30_LATEST_LEDGER.headerXdr, 'base64');

        expect(header.ledgerVersion).toBe(PROTOCOL_30_LATEST_LEDGER.protocolVersion);
        expect(header.ledgerSeq).toBe(PROTOCOL_30_LATEST_LEDGER.sequence);
    });
});
