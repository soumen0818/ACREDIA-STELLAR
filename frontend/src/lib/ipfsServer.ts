import { runtimeConfig, serverRuntimeConfig } from './runtimeConfig';
import { captureException, recordMetric } from './debug';

const PINATA_API_BASE = 'https://api.pinata.cloud/pinning';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_JSON_SIZE_BYTES = 1 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);
const IPFS_FETCH_TIMEOUT_MS = 8_000;

function requirePinataJwt(): string {
    const jwt = serverRuntimeConfig.ipfs.jwt;

    if (!jwt) {
        throw new Error(
            'Missing server-only PINATA_JWT environment variable. Set PINATA_JWT before using IPFS uploads.',
        );
    }

    if (process.env.NODE_ENV === 'production' && !jwt) {
        throw new Error('PINATA_JWT is required in production for IPFS uploads.');
    }

    return jwt;
}

function parsePinataCid(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || !('IpfsHash' in payload)) {
        throw new Error('Unexpected Pinata response.');
    }

    const cid = (payload as { IpfsHash?: unknown }).IpfsHash;

    if (typeof cid !== 'string' || !cid.trim()) {
        throw new Error('Unexpected Pinata response.');
    }

    return cid.trim();
}

export function sanitizePinataFilename(name: string): string {
    // Order matters. Leading traversal segments are removed FIRST, while the
    // separators that delimit them are still present. Replacing separators
    // first would turn "../../../etc/passwd.png" into ".._.._.._etc_passwd.png",
    // and the later leading-dot strip only removes the first run — leaving
    // "_.._.._etc_passwd.png" with the traversal intent still legible.
    const sanitized = name
        // "../", "./", "..\", ".\" repeated any number of times.
        .replace(/^(?:\.{1,2}[/\\])+/, '')
        // Remaining separators collapse to "_", so no path structure survives.
        // eslint-disable-next-line no-control-regex -- matching control characters is the entire point: they are what enables CRLF injection into the multipart headers sent to Pinata.
        .replace(/[\r\n\t\x00-\x1f\x7f-\x9f"/\\]/g, '_')
        // Any dots still leading the name (e.g. a bare "..name") are dropped so
        // the result can never be a relative-path token or a hidden file.
        .replace(/^\.+/, '')
        .trim();

    return sanitized.slice(0, 255) || 'credential_file';
}

export function validatePinataFile(file: File): string | null {
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
        return 'Invalid file type. Please upload PDF, JPG, or PNG files only.';
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        return 'File size must be less than 10MB.';
    }

    return null;
}

export function validatePinataJson(content: unknown): string | null {
    if (content === null || content === undefined) {
        return 'JSON payload cannot be empty.';
    }

    if (typeof content !== 'object' || Array.isArray(content)) {
        return 'JSON payload must be an object.';
    }

    const serialized = JSON.stringify(content);

    if (!serialized || serialized.length === 0) {
        return 'JSON payload cannot be empty.';
    }

    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_SIZE_BYTES) {
        return 'JSON payload must be less than 1MB.';
    }

    return null;
}

export async function pinFileToPinata(file: File): Promise<string> {
    const jwt = requirePinataJwt();
    const startedAt = Date.now();
    const safeFilename = sanitizePinataFilename(file.name);
    const formData = new FormData();
    formData.append('file', file, safeFilename);
    formData.append('pinataMetadata', JSON.stringify({ name: safeFilename }));
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const response = await fetch(`${PINATA_API_BASE}/pinFileToIPFS`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${jwt}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        recordMetric('ipfs.pin_file.error', 1, { status: response.status });
        captureException(new Error(`Pinata file upload failed: ${response.status} ${errorBody}`), { context: 'pinFileToPinata' });
        throw new Error('Pinata file upload failed.');
    }

    recordMetric('ipfs.pin_file.latency_ms', Date.now() - startedAt, { status: response.status });
    return parsePinataCid(await response.json());
}

export async function pinJsonToPinata(content: unknown): Promise<string> {
    const jwt = requirePinataJwt();
    const startedAt = Date.now();

    const response = await fetch(`${PINATA_API_BASE}/pinJSONToIPFS`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
            pinataMetadata: { name: 'credential-metadata.json' },
            pinataOptions: { cidVersion: 1 },
            pinataContent: content,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        recordMetric('ipfs.pin_json.error', 1, { status: response.status });
        captureException(new Error(`Pinata JSON upload failed: ${response.status} ${errorBody}`), { context: 'pinJsonToPinata' });
        throw new Error('Pinata JSON upload failed.');
    }

    recordMetric('ipfs.pin_json.latency_ms', Date.now() - startedAt, { status: response.status });
    return parsePinataCid(await response.json());
}

/**
 * Checks whether Pinata currently reports `cid` as pinned (issue #164).
 * Uses the longstanding `data/pinList` endpoint in the same v1 API family
 * as `pinFileToPinata`/`pinJsonToPinata`.
 */
export async function checkPinataPinStatus(cid: string): Promise<'pinned' | 'missing'> {
    const jwt = requirePinataJwt();

    const response = await fetch(
        `https://api.pinata.cloud/data/pinList?hashContains=${encodeURIComponent(cid)}&status=pinned`,
        { headers: { Authorization: `Bearer ${jwt}` } },
    );

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Pinata pin status check failed: ${response.status} ${errorBody}`);
    }

    const payload = (await response.json()) as { rows?: Array<{ ipfs_pin_hash?: string }> };
    const rows = payload.rows ?? [];

    return rows.some((row) => row.ipfs_pin_hash === cid) ? 'pinned' : 'missing';
}

// ─── Secondary pinning provider (IPFS Pinning Services API) ─────────────────
// https://ipfs.github.io/pinning-services-api-spec/ — implemented by
// Filebase, Crust Network, Temporal, self-hosted ipfs-cluster, and others.
// This is the second, independent provider issue #164 requires: losing
// Pinata alone must not make a credential's document unretrievable.

export type SecondaryPinStatus = 'queued' | 'pinning' | 'pinned' | 'failed';

export interface SecondaryPinResult {
    requestId: string;
    status: SecondaryPinStatus;
}

/** True once an operator has configured a spec-compliant secondary provider. */
export function isSecondaryPinningConfigured(): boolean {
    return Boolean(
        serverRuntimeConfig.pinning.secondaryEndpoint && serverRuntimeConfig.pinning.secondaryToken,
    );
}

function requireSecondaryPinningConfig(): { endpoint: string; token: string } {
    const { secondaryEndpoint, secondaryToken } = serverRuntimeConfig.pinning;

    if (!secondaryEndpoint || !secondaryToken) {
        throw new Error(
            'Secondary pinning provider is not configured. Set SECONDARY_PINNING_ENDPOINT and ' +
                'SECONDARY_PINNING_TOKEN — see docs/ops/pin-redundancy.md.',
        );
    }

    return { endpoint: secondaryEndpoint, token: secondaryToken };
}

function parseSecondaryPinResponse(payload: unknown): SecondaryPinResult {
    const record = (payload ?? {}) as { requestid?: unknown; status?: unknown };
    const validStatuses: SecondaryPinStatus[] = ['queued', 'pinning', 'pinned', 'failed'];
    const status = validStatuses.includes(record.status as SecondaryPinStatus)
        ? (record.status as SecondaryPinStatus)
        : 'failed';

    return {
        requestId: typeof record.requestid === 'string' ? record.requestid : '',
        status,
    };
}

/**
 * Asks the secondary provider to pin an existing CID (pin-by-CID: the
 * provider fetches the content itself from the public IPFS network — it
 * does not need the bytes uploaded to it directly). The content must
 * already be discoverable somewhere on the network (typically because
 * Pinata is currently serving it) for this to succeed.
 */
export async function pinCidToSecondaryProvider(cid: string, name: string): Promise<SecondaryPinResult> {
    const { endpoint, token } = requireSecondaryPinningConfig();

    const response = await fetch(`${endpoint}/pins`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cid, name }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        recordMetric('ipfs.secondary_pin.error', 1, { status: response.status });
        throw new Error(`Secondary pinning provider rejected the pin request: ${response.status} ${errorBody}`);
    }

    return parseSecondaryPinResponse(await response.json());
}

/** Polls the secondary provider for the current status of a previously-submitted pin request. */
export async function getSecondaryPinStatus(requestId: string): Promise<SecondaryPinResult> {
    const { endpoint, token } = requireSecondaryPinningConfig();

    const response = await fetch(`${endpoint}/pins/${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) {
        return { requestId, status: 'failed' };
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Secondary pinning provider status check failed: ${response.status} ${errorBody}`);
    }

    return parseSecondaryPinResponse(await response.json());
}

export interface EncryptedPayload {
    encrypted: true;
    algorithm: 'AES-GCM';
    iv: string;
    ciphertext: string;
}

export async function encryptBufferAESGCM(data: Uint8Array, secretKeyHex: string): Promise<EncryptedPayload> {
    const keyBytes = new Uint8Array(secretKeyHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);
    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, 'AES-GCM', false, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data as unknown as BufferSource);

    return {
        encrypted: true,
        algorithm: 'AES-GCM',
        iv: Buffer.from(iv).toString('base64'),
        ciphertext: Buffer.from(encryptedBuffer).toString('base64'),
    };
}

export async function decryptBufferAESGCM(payload: EncryptedPayload, secretKeyHex: string): Promise<Uint8Array> {
    const keyBytes = new Uint8Array(secretKeyHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);
    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, 'AES-GCM', false, ['decrypt']);
    const iv = new Uint8Array(Buffer.from(payload.iv, 'base64'));
    const ciphertext = new Uint8Array(Buffer.from(payload.ciphertext, 'base64'));
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext as unknown as BufferSource);

    return new Uint8Array(decryptedBuffer);
}

export type IpfsFetchResult =
    | { ok: true; content: unknown }
    | { ok: false; reason: 'not_found' | 'gateway_error' | 'invalid_json' | 'timeout' | 'network_error' };

function ipfsGatewayUrl(cidOrUri: string): string {
    const path = cidOrUri.replace(/^ipfs:\/\//, '');
    return `${runtimeConfig.ipfs.gatewayUrl}/ipfs/${path}`;
}

/**
 * Fetches and parses the JSON document a CID/`ipfs://` URI resolves to, via
 * the public IPFS gateway — used to independently confirm that a CID
 * referenced on-chain actually resolves and to recompute its content hash
 * (see `GET /api/verify/[token]`'s integrity check). Never throws: network
 * failures, timeouts, and non-2xx responses all collapse to `{ ok: false }`
 * so callers can report a clear "unavailable" state instead of a 500.
 */
export async function fetchJsonFromIpfs(cidOrUri: string): Promise<IpfsFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(ipfsGatewayUrl(cidOrUri), { signal: controller.signal });

        if (response.status === 404) {
            return { ok: false, reason: 'not_found' };
        }

        if (!response.ok) {
            recordMetric('ipfs.fetch.error', 1, { status: response.status });
            return { ok: false, reason: 'gateway_error' };
        }

        try {
            return { ok: true, content: await response.json() };
        } catch {
            return { ok: false, reason: 'invalid_json' };
        }
    } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        recordMetric('ipfs.fetch.error', 1, { reason: isAbort ? 'timeout' : 'network_error' });
        return { ok: false, reason: isAbort ? 'timeout' : 'network_error' };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Unpin a CID from Pinata so the content is no longer served over IPFS.
 * Called during GDPR erasure to make previously-pinned credential documents
 * inaccessible. Returns true if the unpin succeeded, false if the CID was
 * not found (already unpinned / never pinned), and throws for other errors.
 */
export async function unpinFromPinata(cid: string): Promise<boolean> {
    const jwt = requirePinataJwt();

    const response = await fetch(`${PINATA_API_BASE}/unpin/${encodeURIComponent(cid)}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${jwt}`,
        },
    });

    if (response.status === 404 || response.status === 400) {
        // CID was never pinned by this account or already unpinned — not an error.
        return false;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        captureException(new Error(`Pinata unpin failed: ${response.status} ${errorBody}`), {
            context: 'unpinFromPinata',
            cid,
        });
        throw new Error('Pinata unpin failed.');
    }

    return true;
}
