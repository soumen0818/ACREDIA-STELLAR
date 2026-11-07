import { rpc } from '@stellar/stellar-sdk';
import { activeNetwork } from './stellar';

// Instantiate Soroban SDK Server helper.
//
// Kept out of `stellar.ts` on purpose: that module holds the network profile,
// which the marketing navbar reads, and building the server there put the
// SDK's RPC client (~540 KB of JS) on every page (review §4.1).
export const sorobanServer = new rpc.Server(activeNetwork.sorobanRpcUrl);
