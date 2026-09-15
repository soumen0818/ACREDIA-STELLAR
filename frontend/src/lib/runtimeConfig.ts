import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

export type StellarNetworkKind = 'testnet' | 'mainnet' | 'custom';
export type ContractName = 'CREDENTIAL_NFT' | 'CREDENTIAL_REGISTRY';

type StellarNetworkConfig = {
    kind: StellarNetworkKind;
    horizonUrl: string;
    sorobanRpcUrl: string;
    networkPassphrase: string;
    networkName: string;
    explorerBaseUrl: string;
};

type RuntimeConfig = {
    isProduction: boolean;
    supabase: {
        url: string;
        anonKey: string;
    };
    stellar: StellarNetworkConfig;
    contracts: Record<ContractName, string>;
    ipfs: {
        gatewayUrl: string;
    };
    debug: {
        enableLogs: boolean;
    };
};

type ServerRuntimeConfig = {
    admin: {
        emailAllowlist: string[];
    };
    auth: {
        serviceRoleKey: string;
    };
    ipfs: {
        jwt: string;
    };
    /**
     * Second, independent IPFS pinning provider (issue #164). Any provider
     * implementing the IPFS Pinning Services API spec
     * (https://ipfs.github.io/pinning-services-api-spec/) works — e.g.
     * Filebase, Crust Network, Temporal, or a self-hosted ipfs-cluster.
     * Both fields empty means redundancy is not configured; the pin-keeper
     * records this honestly as `not_configured` rather than `failed`.
     */
    pinning: {
        secondaryEndpoint: string;
        secondaryToken: string;
        secondaryProviderName: string;
    };
    verification: {
        hashSecret: string;
    };
    /**
     * Shared secret the scheduler presents to /api/cron/*. Vercel Cron sends
     * it automatically as `Authorization: Bearer $CRON_SECRET`. Empty means
     * unconfigured, and the cron routes refuse to run rather than exposing an
     * unauthenticated endpoint that deletes rows (issue #227).
     */
    cron: {
        secret: string;
    };
    debug: {
        enableLogs: boolean;
    };
};

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

const NETWORK_DEFAULTS: Record<Exclude<StellarNetworkKind, 'custom'>, StellarNetworkConfig> = {
    testnet: {
        kind: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: TESTNET_PASSPHRASE,
        networkName: 'testnet',
        explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
    },
    mainnet: {
        kind: 'mainnet',
        horizonUrl: 'https://horizon.stellar.org',
        sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
        networkPassphrase: MAINNET_PASSPHRASE,
        networkName: 'public',
        explorerBaseUrl: 'https://stellar.expert/explorer/public',
    },
};

const networkKindSchema = z.enum(['testnet', 'mainnet', 'custom']);
const debugFlagSchema = z.enum(['true', 'false']).optional().transform((value) => value === 'true');
const PUBLIC_SECRET_ENV_NAMES = [
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_PINATA_JWT',
    'NEXT_PUBLIC_VERIFICATION_LOG_HASH_SECRET',
    'NEXT_PUBLIC_STELLAR_SECRET_KEY',
    'NEXT_PUBLIC_STELLAR_SECRET_SEED',
] as const;

/**
 * Statically-referenced `NEXT_PUBLIC_*` values.
 *
 * Next.js replaces client-side environment variables at build time, but only
 * where they appear as literal `process.env.NEXT_PUBLIC_X` expressions. A
 * dynamic `process.env[name]` lookup is left untouched by the bundler, so in
 * the browser it resolves against an empty object and yields `undefined` for
 * every key — which silently collapsed the whole public config (the Supabase
 * client then fell back to `placeholder.supabase.co` and every request failed
 * with a DNS error).
 *
 * Listing the names here keeps `readEnv(name)` ergonomic while guaranteeing
 * each value is inlined. Server-only variables are intentionally absent: they
 * must never reach the browser, and on the server the dynamic lookup works.
 */
function readRawEnv(name: string): string | undefined {
    switch (name) {
        case 'NEXT_PUBLIC_SUPABASE_URL':
            return process.env.NEXT_PUBLIC_SUPABASE_URL;
        case 'NEXT_PUBLIC_SUPABASE_ANON_KEY':
            return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        case 'NEXT_PUBLIC_STELLAR_NETWORK':
            return process.env.NEXT_PUBLIC_STELLAR_NETWORK;
        case 'NEXT_PUBLIC_CHAIN_ID':
            return process.env.NEXT_PUBLIC_CHAIN_ID;
        case 'NEXT_PUBLIC_NETWORK_NAME':
            return process.env.NEXT_PUBLIC_NETWORK_NAME;
        case 'NEXT_PUBLIC_NETWORK_PASSPHRASE':
            return process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
        case 'NEXT_PUBLIC_HORIZON_URL':
            return process.env.NEXT_PUBLIC_HORIZON_URL;
        case 'NEXT_PUBLIC_SOROBAN_RPC_URL':
            return process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
        case 'NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL':
            return process.env.NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL;
        case 'NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT':
            return process.env.NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT;
        case 'NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT':
            return process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT;
        case 'NEXT_PUBLIC_PINATA_GATEWAY':
            return process.env.NEXT_PUBLIC_PINATA_GATEWAY;
        case 'NEXT_PUBLIC_ENABLE_DEBUG_LOGS':
            return process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS;
        // Listed so the "secret exposed to the browser" guard can observe these
        // client-side, not just on the server.
        case 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY':
            return process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
        case 'NEXT_PUBLIC_PINATA_JWT':
            return process.env.NEXT_PUBLIC_PINATA_JWT;
        case 'NEXT_PUBLIC_VERIFICATION_LOG_HASH_SECRET':
            return process.env.NEXT_PUBLIC_VERIFICATION_LOG_HASH_SECRET;
        case 'NEXT_PUBLIC_STELLAR_SECRET_KEY':
            return process.env.NEXT_PUBLIC_STELLAR_SECRET_KEY;
        case 'NEXT_PUBLIC_STELLAR_SECRET_SEED':
            return process.env.NEXT_PUBLIC_STELLAR_SECRET_SEED;
        // Server-only variables: the dynamic lookup is correct here, because
        // these must never be inlined into the browser bundle.
        default:
            return process.env[name];
    }
}

function readEnv(name: string): string | undefined {
    const value = readRawEnv(name)?.trim();
    return value ? value : undefined;
}

function looksLikePlaceholder(value: string): boolean {
    const normalized = value.toLowerCase();
    return (
        normalized.includes('your-project') ||
        normalized.startsWith('your_') ||
        normalized.startsWith('your-') ||
        normalized.includes('example.com')
    );
}

function configError(message: string): never {
    throw new Error(`[runtime-config] ${message}`);
}

/**
 * A configuration error that must NEVER be degraded past.
 *
 * `initRuntimeConfig()` deliberately swallows ordinary config errors and boots
 * in degraded mode, so a missing `NEXT_PUBLIC_*` variable shows a broken-but-
 * navigable app instead of a white screen. That trade-off is wrong for errors
 * where continuing is actively dangerous — above all, pointing at a testnet
 * contract while the network is set to mainnet. Degrading there would let the
 * app issue and verify against the wrong ledger while looking healthy, which is
 * the worst possible failure for a product whose entire value is trust.
 *
 * Errors of this class are re-thrown, failing the boot loudly.
 */
export class UnsafeConfigError extends Error {
    constructor(message: string) {
        super(`[runtime-config] ${message}`);
        this.name = 'UnsafeConfigError';
    }
}

function unsafeConfigError(message: string): never {
    throw new UnsafeConfigError(message);
}

function requireProductionValue(name: string, value: string | undefined, isProduction: boolean): string {
    const normalizedValue = value?.trim() ?? '';

    if (isProduction && (!normalizedValue || looksLikePlaceholder(normalizedValue))) {
        configError(`${name} is required in production and must not be a placeholder value.`);
    }

    return normalizedValue;
}

function parseHttpUrl(name: string, value: string | undefined): string {
    if (!value) {
        return '';
    }

    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            configError(`${name} must be an HTTP or HTTPS URL.`);
        }

        return url.toString().replace(/\/$/, '');
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('[runtime-config]')) {
            throw error;
        }

        configError(`${name} must be a valid URL.`);
    }
}

function parseNetworkKind(value: string | undefined, isProduction: boolean): StellarNetworkKind {
    const normalizedValue = (value ?? '').toLowerCase().trim();

    if (!normalizedValue) {
        if (isProduction) {
            configError(
                'NEXT_PUBLIC_STELLAR_NETWORK is required in production. Use testnet, mainnet, or custom.',
            );
        }

        return 'testnet';
    }

    const parsed = networkKindSchema.safeParse(normalizedValue);
    if (!parsed.success) {
        configError('NEXT_PUBLIC_STELLAR_NETWORK must be testnet, mainnet, or custom.');
    }

    return parsed.data;
}

function readNetworkSelector(): string | undefined {
    const explicit = readEnv('NEXT_PUBLIC_STELLAR_NETWORK');
    const legacy = readEnv('NEXT_PUBLIC_CHAIN_ID');

    if (
        explicit
        && legacy
        && explicit.trim().toLowerCase() !== legacy.trim().toLowerCase()
    ) {
        configError(
            'NEXT_PUBLIC_STELLAR_NETWORK and NEXT_PUBLIC_CHAIN_ID disagree. Set only NEXT_PUBLIC_STELLAR_NETWORK.',
        );
    }

    return explicit ?? legacy;
}

function assertNoPublicServerSecrets(): void {
    const leakedPublicSecrets = PUBLIC_SECRET_ENV_NAMES.filter((name) => Boolean(readEnv(name)));

    if (leakedPublicSecrets.length > 0) {
        configError(
            `Server-only secrets must never be exposed via NEXT_PUBLIC_* variables. Remove: ${leakedPublicSecrets.join(', ')}`,
        );
    }
}

function requireCustomValue(name: string, value: string | undefined, networkKind: StellarNetworkKind): string {
    const normalizedValue = value?.trim() ?? '';

    if (networkKind === 'custom' && !normalizedValue) {
        configError(`${name} is required when NEXT_PUBLIC_STELLAR_NETWORK=custom.`);
    }

    return normalizedValue;
}

function buildStellarConfig(isProduction: boolean): StellarNetworkConfig {
    const kind = parseNetworkKind(readNetworkSelector(), isProduction);
    const defaults = kind === 'custom' ? null : NETWORK_DEFAULTS[kind];

    if (defaults) {
        const profileLockedFields = [
            ['NEXT_PUBLIC_HORIZON_URL', defaults.horizonUrl],
            ['NEXT_PUBLIC_SOROBAN_RPC_URL', defaults.sorobanRpcUrl],
            ['NEXT_PUBLIC_NETWORK_PASSPHRASE', defaults.networkPassphrase],
            ['NEXT_PUBLIC_NETWORK_NAME', defaults.networkName],
            ['NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL', defaults.explorerBaseUrl],
        ] as const;

        for (const [envName, expectedValue] of profileLockedFields) {
            const explicitValue = readEnv(envName);
            if (explicitValue && explicitValue !== expectedValue) {
                configError(
                    `${envName} cannot override the ${kind} profile. Use NEXT_PUBLIC_STELLAR_NETWORK=custom for custom endpoints.`,
                );
            }
        }

        return defaults;
    }

    const horizonValue = requireCustomValue('NEXT_PUBLIC_HORIZON_URL', readEnv('NEXT_PUBLIC_HORIZON_URL'), kind);
    const rpcValue = requireCustomValue('NEXT_PUBLIC_SOROBAN_RPC_URL', readEnv('NEXT_PUBLIC_SOROBAN_RPC_URL'), kind);
    const passphraseValue = requireCustomValue(
        'NEXT_PUBLIC_NETWORK_PASSPHRASE',
        readEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE'),
        kind,
    );
    const networkName = readEnv('NEXT_PUBLIC_NETWORK_NAME') || 'custom';
    const explorerValue = requireCustomValue(
        'NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL',
        readEnv('NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL'),
        kind,
    );

    return {
        kind,
        horizonUrl: parseHttpUrl('NEXT_PUBLIC_HORIZON_URL', horizonValue),
        sorobanRpcUrl: parseHttpUrl('NEXT_PUBLIC_SOROBAN_RPC_URL', rpcValue),
        networkPassphrase: passphraseValue,
        networkName,
        explorerBaseUrl: parseHttpUrl('NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL', explorerValue),
    };
}

function readContractId(name: ContractName, envName: string, isProduction: boolean, networkKind: StellarNetworkKind): string {
    const value = requireProductionValue(envName, readEnv(envName), isProduction);
    if (value && !StrKey.isValidContract(value)) {
        configError(`${envName} must be a valid Stellar contract ID for ${name}.`);
    }

    // Fail fast if a known testnet contract is used on mainnet
    const KNOWN_TESTNET_CONTRACT = 'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK';
    if (networkKind === 'mainnet' && value === KNOWN_TESTNET_CONTRACT) {
        // Unsafe, not merely invalid: booting past this would issue and verify
        // real credentials against a testnet contract while reporting success.
        unsafeConfigError(
            `Cannot use the known testnet contract ${value} on mainnet for ${name}. `
                + 'Update NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT / '
                + 'NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT to the deployed mainnet contract IDs.',
        );
    }

    return value;
}

function parseEmailAllowlist(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function buildRuntimeConfig(): RuntimeConfig {
    const isProduction = process.env.NODE_ENV === 'production';
    assertNoPublicServerSecrets();
    const supabaseUrl = requireProductionValue(
        'NEXT_PUBLIC_SUPABASE_URL',
        readEnv('NEXT_PUBLIC_SUPABASE_URL'),
        isProduction,
    );
    const supabaseAnonKey = requireProductionValue(
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        isProduction,
    );
    const debugFlag = debugFlagSchema.safeParse(readEnv('NEXT_PUBLIC_ENABLE_DEBUG_LOGS'));

    const stellar = buildStellarConfig(isProduction);
    
    return {
        isProduction,
        supabase: {
            url: parseHttpUrl('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl),
            anonKey: supabaseAnonKey,
        },
        stellar,
        contracts: {
            CREDENTIAL_NFT: readContractId(
                'CREDENTIAL_NFT',
                'NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT',
                isProduction,
                stellar.kind
            ),
            CREDENTIAL_REGISTRY: readContractId(
                'CREDENTIAL_REGISTRY',
                'NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT',
                isProduction,
                stellar.kind
            ),
        },
        ipfs: {
            gatewayUrl: parseHttpUrl(
                'NEXT_PUBLIC_PINATA_GATEWAY',
                readEnv('NEXT_PUBLIC_PINATA_GATEWAY') || 'https://gateway.pinata.cloud',
            ),
        },
        debug: {
            enableLogs: debugFlag.success ? debugFlag.data : false,
        },
    };
}

function buildServerRuntimeConfig(): ServerRuntimeConfig {
    const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const pinataJwt = readEnv('PINATA_JWT') ?? '';

    return {
        admin: {
            emailAllowlist: parseEmailAllowlist(readEnv('ADMIN_EMAIL_ALLOWLIST')),
        },
        auth: {
            serviceRoleKey,
        },
        ipfs: {
            jwt: pinataJwt,
        },
        pinning: {
            secondaryEndpoint: (readEnv('SECONDARY_PINNING_ENDPOINT') ?? '').replace(/\/$/, ''),
            secondaryToken: readEnv('SECONDARY_PINNING_TOKEN') ?? '',
            secondaryProviderName: readEnv('SECONDARY_PINNING_PROVIDER_NAME') ?? 'secondary',
        },
        verification: {
            hashSecret:
                readEnv('VERIFICATION_LOG_HASH_SECRET') ??
                serviceRoleKey ??
                'local-verification-log-hash-secret',
        },
        cron: {
            // Deliberately no fallback: a guessable or shared default would
            // make the purge endpoint callable by anyone.
            secret: readEnv('CRON_SECRET') ?? '',
        },
        debug: {
            enableLogs: runtimeConfig.debug.enableLogs,
        },
    };
}

export function getRuntimeConfig(): RuntimeConfig {
    return buildRuntimeConfig();
}

export function getServerRuntimeConfig(): ServerRuntimeConfig {
    return buildServerRuntimeConfig();
}

// Best-effort configuration used only when the strict validation above fails.
// This prevents a single missing/invalid NEXT_PUBLIC_* value from throwing at
// module-evaluation time and taking the entire app down into the global error
// screen ("Acredia hit an unexpected issue"). Instead the app renders and only
// the features that depend on the missing value are degraded. The failure is
// still logged loudly (visible in the browser console and in build logs).
function buildFallbackRuntimeConfig(): RuntimeConfig {
    const safeUrl = (name: string, fallback = ''): string => {
        const raw = readEnv(name);
        if (!raw) return fallback;
        try {
            return new URL(raw).toString().replace(/\/$/, '');
        } catch {
            return fallback;
        }
    };

    let stellar: StellarNetworkConfig;
    try {
        stellar = buildStellarConfig(false);
    } catch {
        stellar = NETWORK_DEFAULTS.testnet;
    }

    return {
        isProduction: process.env.NODE_ENV === 'production',
        supabase: {
            url: safeUrl('NEXT_PUBLIC_SUPABASE_URL'),
            anonKey: readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? '',
        },
        stellar,
        contracts: {
            CREDENTIAL_NFT: readEnv('NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT') ?? '',
            CREDENTIAL_REGISTRY: readEnv('NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT') ?? '',
        },
        ipfs: {
            gatewayUrl: safeUrl('NEXT_PUBLIC_PINATA_GATEWAY', 'https://gateway.pinata.cloud'),
        },
        debug: {
            enableLogs: false,
        },
    };
}

function initRuntimeConfig(): RuntimeConfig {
    try {
        return buildRuntimeConfig();
    } catch (error) {
        // Never degrade past an unsafe configuration — see UnsafeConfigError.
        // A mainnet deployment pointed at a testnet contract must fail the boot,
        // not serve a confident-looking app backed by the wrong ledger.
        if (error instanceof UnsafeConfigError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        // Intentionally logged directly (not via debug.ts, whose logging is gated
        // off in production) so this misconfiguration is always visible.
        // eslint-disable-next-line no-console
        console.error(
            '[runtime-config] Public configuration is missing or invalid; the app is running in '
                + 'degraded mode. Set the required NEXT_PUBLIC_* environment variables in your hosting '
                + `platform (e.g. Vercel) for the Production environment and redeploy. Details: ${message}`,
        );
        return buildFallbackRuntimeConfig();
    }
}

export const runtimeConfig = initRuntimeConfig();
export const serverRuntimeConfig = getServerRuntimeConfig();

export function getConfiguredContractId(contractName: ContractName): string {
    const contractId = runtimeConfig.contracts[contractName];
    if (!contractId) {
        configError(
            `Missing contract ID for ${contractName}. Set NEXT_PUBLIC_${contractName}_CONTRACT.`,
        );
    }

    return contractId;
}

export function assertValidStellarPublicKey(value: unknown, label = 'Wallet address'): string {
    if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value.trim())) {
        configError(`${label} must be a valid Stellar public key.`);
    }

    return value.trim();
}
