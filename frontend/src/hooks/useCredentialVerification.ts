import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVerificationInput } from '@/lib/verification';
import { debugWarn } from '@/lib/debug';

export type RevocationSource = 'issuer' | 'platform' | null;

export type CredentialStatus = 'valid' | 'revoked' | 'expired';

/**
 * What a bare token ID reveals: status only (review §3.11b). Everything here
 * is read from the contract except the institution's display name and the
 * revocation label. The holder's name, the credential's content and its
 * document are only reachable through the holder's share link.
 */
export interface CredentialStatusRecord {
    token_id: string;
    status: CredentialStatus;
    issued_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
    revocation_source: RevocationSource;
    institution_name: string | null;
    issuer_wallet_address: string | null;
    on_chain_hash: string | null;
    /** Whether the issuer is still authorized on the contract; null if unknown. */
    issuer_authorized: boolean | null;
}

function normalizeRevocationSource(value: unknown): RevocationSource {
    return value === 'issuer' || value === 'platform' ? value : null;
}

function isCredentialStatus(value: unknown): value is CredentialStatus {
    return value === 'valid' || value === 'revoked' || value === 'expired';
}

/**
 * Maps a successful `/api/verify/:tokenId` payload to the page's record.
 * Fails closed: a payload without a recognised status throws rather than
 * rendering as verified.
 */
export function parseVerificationResponse(payload: {
    credential?: Record<string, unknown>;
    verification?: Record<string, unknown>;
}): CredentialStatusRecord {
    const safe = payload.credential ?? {};
    const verification = payload.verification ?? {};
    if (!isCredentialStatus(safe.status)) {
        throw new Error('Verification unavailable: unexpected response.');
    }
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return {
        token_id: String(safe.tokenId),
        status: safe.status,
        issued_at: text(safe.issuedAt),
        expires_at: text(safe.expiresAt),
        revoked_at: text(safe.revokedAt),
        revocation_source: normalizeRevocationSource(safe.revocationSource),
        institution_name: text(safe.institutionName),
        issuer_wallet_address: text(safe.institutionWallet),
        on_chain_hash: text(safe.onChainHash),
        issuer_authorized:
            typeof verification.issuerAuthorized === 'boolean' ? verification.issuerAuthorized : null,
    };
}

export type ScanState =
    | 'idle'
    | 'requesting'
    | 'scanning'
    | 'success'
    | 'permission-denied'
    | 'no-camera'
    | 'invalid'
    | 'unsupported'
    | 'error';

export function useCredentialVerification(tokenId: string | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Html5Qrcode is dynamically imported; narrowing to its full API is impractical
    const scannerRef = useRef<any>(null);
    const [loading, setLoading] = useState(true);
    const [credential, setCredential] = useState<CredentialStatusRecord | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [manualToken, setManualToken] = useState('');
    const [scanMode, setScanMode] = useState(false);
    const [scanState, setScanState] = useState<ScanState>('idle');
    const [scanMessage, setScanMessage] = useState('Scan the credential QR code to verify it instantly.');

    const stopScanner = useCallback(async () => {
        const scanner = scannerRef.current;
        if (!scanner) return;
        try {
            if (scanner.isScanning) await scanner.stop();
        } catch (err) {
            debugWarn('Unable to stop QR scanner:', err);
        }
        try {
            await scanner.clear();
        } catch (err) {
            debugWarn('Unable to clear QR scanner:', err);
        }
        scannerRef.current = null;
    }, []);

    useEffect(() => {
        return () => {
            void stopScanner();
        };
    }, [stopScanner]);

    useEffect(() => {
        if (!scanMode) {
            void stopScanner();
            setScanState('idle');
            setScanMessage('Scan the credential QR code to verify it instantly.');
        }
    }, [scanMode, stopScanner]);

    const verifyCredential = useCallback(async (token: string) => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`/api/verify/${encodeURIComponent(token)}`);
            const payload = await response.json();

            if (!response.ok || !payload?.success || !payload?.credential) {
                throw new Error(payload?.error || 'Credential not found. The token ID may be invalid.');
            }

            setCredential(parseVerificationResponse(payload));
        } catch (err: unknown) {
            setCredential(null);
            setError((err instanceof Error ? err.message : String(err)) || 'Failed to verify credential');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tokenId) {
            void verifyCredential(tokenId);
        } else {
            setLoading(false);
        }
    }, [tokenId, verifyCredential]);

    const verifyToken = useCallback((token: string) => {
        const cleanedToken = token.trim();
        if (!cleanedToken) return;
        const target = parseVerificationInput(cleanedToken);
        // A share link shows the details and document on its own page.
        if (target?.kind === 'share') {
            window.location.assign(`/credentials/${target.shareToken}`);
            return;
        }
        const tokenId = target?.tokenId ?? cleanedToken;
        window.history.pushState({}, '', `/verify?token=${encodeURIComponent(tokenId)}`);
        void verifyCredential(tokenId);
    }, [verifyCredential]);

    const handleManualVerify = useCallback(() => {
        if (manualToken.trim()) {
            verifyToken(manualToken);
        }
    }, [manualToken, verifyToken]);

    const startScanner = useCallback(async () => {
        if (!scanMode) {
            setScanMode(true);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setScanState('unsupported');
            setScanMessage('This browser does not support camera scanning. Enter the token ID manually.');
            return;
        }

        setScanState('requesting');
        setScanMessage('Waiting for camera permission...');
        await stopScanner();

        try {
            const { Html5Qrcode } = await import('html5-qrcode');
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras.length) {
                setScanState('no-camera');
                setScanMessage('No camera was found on this device. Enter the token ID manually.');
                return;
            }

            const readerElement = document.getElementById('credential-qr-reader');
            if (!readerElement) {
                setScanState('error');
                setScanMessage('The scanner could not be initialized. Please try again.');
                return;
            }

            const preferredCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label)) || cameras[0];
            const scanner = new Html5Qrcode('credential-qr-reader', false);
            scannerRef.current = scanner;
            setScanState('scanning');
            setScanMessage('Point your camera at the credential QR code.');

            await scanner.start(
                preferredCamera.id,
                {
                    fps: 10,
                    qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
                        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                        const qrboxSize = Math.floor(minEdge * 0.72);
                        return { width: qrboxSize, height: qrboxSize };
                    },
                    aspectRatio: 1,
                },
                async (decodedText: string) => {
                    const scanned = parseVerificationInput(decodedText);
                    if (!scanned) {
                        setScanState('invalid');
                        setScanMessage('This QR code does not contain a valid Acredia verification URL or token ID.');
                        return;
                    }
                    setScanState('success');
                    setScanMessage('QR code found. Loading the verification report...');
                    await stopScanner();
                    verifyToken(scanned.kind === 'share' ? scanned.shareToken : scanned.tokenId);
                },
                () => undefined,
            );
        } catch (err: unknown) {
            const errorName = err instanceof Error ? err.name : '';
            const errorMessage = String(err instanceof Error ? err.message : err);
            if (errorName === 'NotAllowedError' || errorMessage.toLowerCase().includes('permission')) {
                setScanState('permission-denied');
                setScanMessage('Camera permission was denied. Allow camera access in your browser settings or enter the token ID manually.');
                return;
            }
            if (errorName === 'NotFoundError' || errorMessage.toLowerCase().includes('not found')) {
                setScanState('no-camera');
                setScanMessage('No camera was found on this device. Enter the token ID manually.');
                return;
            }
            setScanState('error');
            setScanMessage('The camera scanner could not start. Check browser permissions and try again.');
        }
    }, [scanMode, stopScanner, verifyToken]);

    return {
        loading,
        credential,
        error,
        manualToken,
        setManualToken,
        scanMode,
        setScanMode,
        scanState,
        setScanState,
        scanMessage,
        setScanMessage,
        handleManualVerify,
        startScanner,
        stopScanner,
        verifyToken,
        verifyCredential,
    };
}
