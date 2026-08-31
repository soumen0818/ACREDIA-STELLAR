import { Keypair, StrKey } from '@stellar/stellar-sdk';

/**
 * Server-side proof of Stellar wallet ownership (Issue #243).
 *
 * The claim flow is an account-creation path gated only by a signature, so
 * every check that matters happens here on the server: a client can present a
 * signature, but it can never assert that the signature is valid.
 */

/** How long a challenge stays usable. Short, because it only has to survive one wallet prompt. */
export const CLAIM_NONCE_TTL_SECONDS = 5 * 60;

/**
 * Builds the human-readable message a student signs.
 *
 * The wallet address is embedded in the signed text, not merely checked
 * alongside it, so a signature captured for one wallet cannot be replayed as
 * proof for another. The purpose line is there so a student can read in their
 * wallet exactly what they are agreeing to.
 */
export function buildClaimMessage(walletAddress: string, nonce: string): string {
    return [
        'Acredia — prove wallet ownership',
        '',
        'Signing this message proves you control this wallet so you can claim',
        'the credentials issued to it. It authorises no payment and no transfer.',
        '',
        `Wallet: ${walletAddress}`,
        `Challenge: ${nonce}`,
    ].join('\n');
}

/**
 * Verifies a signature over {@link buildClaimMessage} against a Stellar
 * address.
 *
 * Accepts the signature as base64 (Freighter v4 returns a base64 string; v3
 * returns a Buffer the caller serialises the same way). Any malformed input —
 * a bad address, undecodable base64, a wrong-length signature — is a failed
 * verification, never a thrown error, so a caller cannot distinguish "invalid
 * signature" from "malformed request" by watching for exceptions.
 */
export function verifyWalletSignature(
    walletAddress: string,
    message: string,
    signatureBase64: string,
): boolean {
    if (!walletAddress || !message || !signatureBase64) {
        return false;
    }

    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
        return false;
    }

    let signature: Buffer;
    try {
        signature = Buffer.from(signatureBase64, 'base64');
    } catch {
        return false;
    }

    // Ed25519 signatures are exactly 64 bytes. Buffer.from silently ignores
    // invalid base64 characters, so this length check is what actually
    // rejects garbage input.
    if (signature.length !== 64) {
        return false;
    }

    try {
        const keypair = Keypair.fromPublicKey(walletAddress);
        return keypair.verify(Buffer.from(message, 'utf8'), signature);
    } catch {
        return false;
    }
}

/**
 * Normalises what Freighter returns into base64.
 *
 * `signMessage` returns a Buffer on v3 of the API and a base64 string on v4;
 * a claim must work on both rather than failing for whichever the student
 * happens to have installed.
 */
export function normalizeSignedMessage(signed: string | Uint8Array | null): string | null {
    if (!signed) return null;

    if (typeof signed === 'string') {
        return signed;
    }

    return Buffer.from(signed).toString('base64');
}
