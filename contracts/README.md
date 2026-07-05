# Acredia Stellar Contracts

Rust-based Soroban smart contracts for Academic Credential Verification on Stellar Network.

## Overview

This repository contains a production-ready Soroban smart contract for Acredia's credential issuance and verification system on Stellar Network.

### AcrediaCredential Contract (`src/lib.rs`)

Single unified contract combining credential issuance, registry, and verification:

**Core Responsibilities**:
1. **Issuance**: Authorize institutions and issue credentials
2. **Storage**: Immutable on-chain credential storage
3. **Verification**: Public credential verification by hash
4. **Management**: Revocation and issuer authorization control

**Key Functions**:
- `initialize(owner)` - Initialize contract once with owner authorization
- `get_owner()` - Read the current contract owner
- `get_pending_owner()` - Read the pending owner awaiting acceptance
- `transfer_owner(new_owner)` - Propose a two-step ownership transfer
- `accept_owner()` - Accept a pending ownership transfer
- `authorize_issuer(issuer)` - Authorize an institution to issue
- `revoke_issuer(issuer)` - Revoke institution authorization
- `is_authorized_issuer(issuer)` - Check authorization status
- `issue_credential(student, issuer, hash, uri)` - Issue new credential
- `revoke_credential(token_id, issuer)` - Revoke issued credential
- `get_credential(token_id)` - Get credential by ID
- `verify_credential(hash)` - Verify credential by hash
- `is_revoked(token_id)` - Check revocation status
- `total_credentials()` - Get total credentials issued
- `bump_credential(token_id)` - Extend TTL of a credential (permissionless)
- `upgrade(new_wasm_hash)` - Upgrade contract WASM code (Owner only)
- `get_storage_version()` - Read the current storage schema version
- `migrate()` - Run schema and data migrations (Owner only)

## Prerequisites

Before building and deploying, ensure you have:

1. **Rust Toolchain** (1.70.0 or later)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Soroban CLI**
   ```bash
   cargo install --locked soroban-cli
   ```

3. **Stellar Account**
   ```bash
   soroban config identity generate --name admin
   soroban config identity fund --identity admin
   ```

## Project Structure

```
contracts/
├── Cargo.toml                   # Rust package manifest
│   ├── soroban-sdk = "20.3.0"  # Soroban smart contract SDK
├── src/
│   └── lib.rs                   # AcrediaCredential contract
├── README.md                    # This file
└── .gitignore                   # Git ignore rules
```

## Development

### Build Contract

```bash
cd contracts
cargo build --target wasm32v1-none --release
```

**Output**: `target/wasm32v1-none/release/acredia_stellar.wasm`

### Run Tests

```bash
cargo test --lib
```

### Format and Lint

```bash
cargo fmt
cargo clippy
cargo check
```

## Deployment Guide

### Step 1: Set Up Testnet

```bash
# Create Stellar identity
soroban config identity generate --name admin

# Fund account with testnet XLM
soroban config identity fund --identity admin

# Verify account
soroban config identity address --name admin
```

### Step 2: Build Contract

```bash
cargo build --target wasm32v1-none --release
```

### Step 3: Deploy to Stellar Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source admin \
  --network testnet
```

**Save the contract ID** from output (format: `CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)

### Step 4: Initialize Contract

```bash
# Get your account address
ADMIN_ADDR=$(soroban config identity address --name admin)

# Initialize contract with your address as owner
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  initialize \
  --owner $ADMIN_ADDR
```

Initialization is one-time only. Any later call to `initialize` will fail and cannot overwrite the owner or reset token sequencing.

### Step 4b: Transfer Ownership Safely (Optional)

Ownership transfers use a two-step flow:

1. Current owner proposes a new owner:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  transfer_owner \
  --new_owner <NEW_OWNER_ADDRESS>
```

2. Pending owner accepts ownership:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <NEW_OWNER_IDENTITY> \
  --network testnet \
  -- \
  accept_owner
```

### Step 5: Configure Frontend

Update `frontend/.env`:

```env
NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT=<CONTRACT_ID>
NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT=<CONTRACT_ID>
NEXT_PUBLIC_CHAIN_ID=testnet
NEXT_PUBLIC_NETWORK_NAME=stellarTestnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

## Production Deployment (Mainnet)

```bash
# Build with optimizations (same command)
cargo build --target wasm32v1-none --release

# Deploy to Stellar Mainnet
soroban contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source admin \
  --network public
```

Update `frontend/.env`:
```env
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
```

## Contract Operations

### Authorize an Issuer (Institution)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  authorize_issuer \
  --issuer <INSTITUTION_ADDRESS>
```

### Revoke an Issuer (Institution)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  revoke_issuer \
  --issuer <INSTITUTION_ADDRESS>
```

Important semantics:
- `revoke_issuer` only prevents that institution from issuing new credentials.
- Previously issued credentials remain stored immutably and remain verifiable.
- Revoking an issuer does not retroactively invalidate or alter older credentials.
- The verify UI surfaces the issuer authorization state explicitly so verifiers can see whether the issuer is currently authorized.

### Issue a Credential

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <INSTITUTION_ADDRESS> \
  --network testnet \
  -- \
  issue_credential \
  --student <STUDENT_ADDRESS> \
  --issuer <INSTITUTION_ADDRESS> \
  --credential_hash "<64_CHAR_SHA256_HEX_DIGEST>" \
  --ipfs_uri "ipfs_hash_value"
```

### Verify Credential

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  verify_credential \
  --credential_hash "<64_CHAR_SHA256_HEX_DIGEST>"
```

### Check Revocation Status

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  is_revoked \
  --token_id 1
```

### Revoke a Credential

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <INSTITUTION_ADDRESS> \
  --network testnet \
  -- \
  revoke_credential \
  --token_id 1 \
  --issuer <INSTITUTION_ADDRESS>
```

## Contract Verification

View deployed contracts on Stellar Expert:

- **Testnet**: https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>
- **Mainnet**: https://stellar.expert/explorer/public/contract/<CONTRACT_ID>

## Troubleshooting

### Build Errors
- **Solution**: Update Rust: `rustup update`
- **Solution**: Install Soroban CLI: `cargo install --locked soroban-cli`

### Deployment Fails
- **Check**: Account has XLM for fees: `soroban account info --source admin --network testnet`
- **Check**: Network connectivity: `curl https://horizon-testnet.stellar.org`

### Contract Invocation Issues
- **Debug**: Add `--trace` flag to see detailed logs
- **Check**: Contract ID is correct format (starts with C)
- **Check**: Source account has XLM for fees

## Documentation & Resources

- **[Soroban Documentation](https://developers.stellar.org/docs/learn/stellar-core/soroban-introduction)**
- **[Soroban SDK Repository](https://github.com/stellar/rs-soroban-sdk)**
- **[Stellar CLI Guide](https://developers.stellar.org/docs/build/guides/cli)**
- **[Soroban Examples](https://github.com/stellar/rs-soroban-sdk/tree/master/examples)**
- **[Stellar Laboratory](https://laboratory.stellar.org/)**

## Contract Upgrades & Governance

This contract features an owner-gated upgradeability and data migration path to allow resolving bugs or updating contract logic without redeploying a new contract address (which would break existing QR codes/verification links).

### Who Can Upgrade?
Only the contract `Owner` can perform upgrades. The `upgrade` function uses `owner.require_auth()` to prevent unauthorized code updates.

### Upgrade Governance & Security
- **Current Model**: Single-signature authorization. The contract owner account must sign the transaction to execute the upgrade.
- **Recommendations for Production**: It is highly recommended that the `Owner` address is set to a multi-signature account (e.g., using Stellar's native multi-sig capabilities or a smart contract multisig wallet) or governed by a timelock contract to prevent immediate or malicious upgrades.

### Upgrade Procedure
To upgrade the contract WASM:
1. **Upload New WASM Code**:
   ```bash
   soroban contract deploy \
     --wasm target/wasm32v1-none/release/acredia_stellar_new.wasm \
     --source admin \
     --network testnet
   ```
   Note down the new WASM hash returned (different from the contract deployment contract ID).

2. **Invoke Upgrade**:
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- \
     upgrade \
     --new_wasm_hash "<NEW_WASM_HASH>"
   ```

3. **Schema / State Migration** (If applicable):
   If the new WASM version introduces changes to the storage structures, run the migration function:
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- \
     migrate
   ```

## Storage Archival & TTL Strategy

Soroban persistent storage entries have a finite TTL (Time-To-Live) measured in ledgers. Entries whose TTL expires are **archived** and become inaccessible until restored. For a credential platform this is a correctness failure — `verify_credential` would silently return `None` for a legitimately issued credential.

### How this contract prevents archival

Every write and read operation calls `extend_ttl` on all affected entries:

| Entry type | Storage kind | TTL strategy |
|---|---|---|
| `Credential(token_id)` | Persistent | Extended to **6,312,000 ledgers (~1 year)** on every write and read |
| `HashIndex(hash)` | Persistent | Same as above (co-extended with Credential) |
| `TotalCredentials` | Persistent | Extended to 1 year on every write and read |
| Instance (`Owner`, `Authorized`, `NextTokenId`, …) | Instance | Extended to 1 year on every entry point |

The threshold to re-extend is set at **3,110,400 ledgers (~6 months)**. An `extend_ttl` call is a no-op when the current TTL is already above the threshold, so the cost is zero on most reads.

### Constants (in `src/lib.rs`)

```rust
const PERSISTENT_BUMP_AMOUNT: u32 = 6_312_000; // max_entry_ttl (protocol 26)
const PERSISTENT_THRESHOLD:   u32 = 3_110_400; // re-extend when < 6 months remain
const INSTANCE_BUMP_AMOUNT:   u32 = 6_312_000;
const INSTANCE_THRESHOLD:     u32 = 3_110_400;
```

### Public bump entry-point

Anyone (no authorization required) can call `bump_credential(token_id)` to extend the TTL of a single credential and its hash index. This allows:

- **Off-chain keepers / bots** to maintain credentials with a periodic sweep.
- **Credential holders** to keep their own credential alive.
- **Third-party verifiers** to ensure a credential they rely on stays accessible.

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- \
  bump_credential \
  --token_id 1
```

### Archival & restore model

If an entry's TTL expires before it is bumped, the network archives it. The entry is no longer readable until it is restored via `RestoreFootprintOp`. After restoration the entry can be bumped again.

Restoration is an off-chain operation performed via the Stellar CLI or Horizon API and is outside the scope of this contract. See [Stellar docs — restoring archived data](https://developers.stellar.org/docs/learn/smart-contract-internals/persisting-data) for details.

### Recommended off-chain TTL maintenance

For production deployments:
1. Run a keeper bot that queries all issued token IDs and calls `bump_credential` for each one on a weekly basis.
2. Monitor contract instance TTL and call `total_credentials` (which also bumps instance storage) periodically.
3. Set alerts when a credential's live-until ledger falls below 1,000,000 (≈ 60 days).

## Security Notes

⚠️ **Critical**:
- Never commit private keys or secrets
- Always use separate accounts for testnet and mainnet
- Audit contract code before mainnet deployment
- Verify contract IDs on Stellar Expert before interactions
- Implement proper access control in backend systems
- Monitor for unauthorized issuers
- Run a keeper bot to extend credential TTLs (see Storage Archival section above)

## License

MIT - Academic and Commercial Use

## Support

For issues or questions:
1. Check [Soroban Discord](https://discord.gg/stellardev)
2. Review [Stellar Documentation](https://developers.stellar.org/)
3. Check this repository's issues

```

## Questions & Support

For any questions or suggestions, open an issue on the [GitHub repository](https://github.com/Soumen1080/ACREDIA-STELLAR) or refer to the [Stellar Developers documentation](https://developers.stellar.org/).
