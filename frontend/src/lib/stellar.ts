import { rpc } from '@stellar/stellar-sdk';
import { debugWarn } from './debug';
import { runtimeConfig } from './runtimeConfig';

// Contract addresses (Stellar contract addresses)
export const CONTRACTS = {
    CREDENTIAL_NFT: runtimeConfig.contracts.CREDENTIAL_NFT,
    CREDENTIAL_REGISTRY: runtimeConfig.contracts.CREDENTIAL_REGISTRY,
};

export function getContractAddress(contractName: keyof typeof CONTRACTS) {
    const address = CONTRACTS[contractName];
    if (!address) {
        debugWarn(`Contract address for ${contractName} not set`);
    }
    return address;
}

// Active network - uses the validated runtime selection.
export const activeNetwork = {
    kind: runtimeConfig.stellar.kind,
    horizonUrl: runtimeConfig.stellar.horizonUrl,
    sorobanRpcUrl: runtimeConfig.stellar.sorobanRpcUrl,
    networkPassphrase: runtimeConfig.stellar.networkPassphrase,
    networkName: runtimeConfig.stellar.networkName,
    explorerBaseUrl: runtimeConfig.stellar.explorerBaseUrl,
};

// Instantiate Soroban SDK Server helper
export const sorobanServer = new rpc.Server(activeNetwork.sorobanRpcUrl);

// Explorer links come from the validated network profile, so they follow the
// network the app runs on (testnet, mainnet or a custom explorer) instead of
// being written into components (review §3.4).
function explorerUrl(path: string): string {
    return `${activeNetwork.explorerBaseUrl.replace(/\/+$/, '')}/${path}`;
}

export function getExplorerTxUrl(txHash: string): string {
    return explorerUrl(`tx/${txHash}`);
}

export function getExplorerAddressUrl(address: string): string {
    return explorerUrl(`account/${address}`);
}
