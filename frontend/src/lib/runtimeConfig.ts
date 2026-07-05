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
    verification: {
        hashSecret: string;
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

function readEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
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

function requireCustomValue(name: string, value: string | undefined, networkKind: StellarNetworkKind): string {
    const normalizedValue = value?.trim() ?? '';

    if (networkKind === 'custom' && !normalizedValue) {
        configError(`${name} is required when NEXT_PUBLIC_STELLAR_NETWORK=custom.`);
    }

    return normalizedValue;
}

function buildStellarConfig(isProduction: boolean): StellarNetworkConfig {
    const kind = parseNetworkKind(
        readEnv('NEXT_PUBLIC_STELLAR_NETWORK') || readEnv('NEXT_PUBLIC_CHAIN_ID'),
        isProduction,
    );
    const defaults = kind === 'custom' ? null : NETWORK_DEFAULTS[kind];

    const horizonValue = readEnv('NEXT_PUBLIC_HORIZON_URL') || defaults?.horizonUrl || '';
    const rpcValue = readEnv('NEXT_PUBLIC_SOROBAN_RPC_URL') || defaults?.sorobanRpcUrl || '';
    const passphraseValue = readEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE') || defaults?.networkPassphrase || '';
    const networkName = readEnv('NEXT_PUBLIC_NETWORK_NAME') || defaults?.networkName || 'custom';
    const explorerValue = readEnv('NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL') || defaults?.explorerBaseUrl || '';

    const networkPassphrase = requireCustomValue(
        'NEXT_PUBLIC_NETWORK_PASSPHRASE',
        passphraseValue,
        kind,
    );

    if (defaults && networkPassphrase !== defaults.networkPassphrase) {
        configError(`NEXT_PUBLIC_NETWORK_PASSPHRASE does not match the selected ${kind} network.`);
    }

    return {
        kind,
        horizonUrl: parseHttpUrl(
            'NEXT_PUBLIC_HORIZON_URL',
            requireCustomValue('NEXT_PUBLIC_HORIZON_URL', horizonValue, kind),
        ),
        sorobanRpcUrl: parseHttpUrl(
            'NEXT_PUBLIC_SOROBAN_RPC_URL',
            requireCustomValue('NEXT_PUBLIC_SOROBAN_RPC_URL', rpcValue, kind),
        ),
        networkPassphrase,
        networkName,
        explorerBaseUrl: parseHttpUrl(
            'NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL',
            requireCustomValue('NEXT_PUBLIC_STELLAR_EXPLORER_BASE_URL', explorerValue, kind),
        ),
    };
}

function readContractId(name: ContractName, envName: string, isProduction: boolean): string {
    const value = requireProductionValue(envName, readEnv(envName), isProduction);
    if (value && !StrKey.isValidContract(value)) {
        configError(`${envName} must be a valid Stellar contract ID for ${name}.`);
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

    return {
        isProduction,
        supabase: {
            url: parseHttpUrl('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl),
            anonKey: supabaseAnonKey,
        },
        stellar: buildStellarConfig(isProduction),
        contracts: {
            CREDENTIAL_NFT: readContractId(
                'CREDENTIAL_NFT',
                'NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT',
                isProduction,
            ),
            CREDENTIAL_REGISTRY: readContractId(
                'CREDENTIAL_REGISTRY',
                'NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT',
                isProduction,
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
        verification: {
            hashSecret:
                readEnv('VERIFICATION_LOG_HASH_SECRET') ??
                serviceRoleKey ??
                'local-verification-log-hash-secret',
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

export const runtimeConfig = getRuntimeConfig();
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
