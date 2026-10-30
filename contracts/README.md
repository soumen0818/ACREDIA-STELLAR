# Acredia Stellar Contracts

Rust-based Soroban smart contracts for Academic Credential Verification on Stellar Network.

## Overview

This repository contains a production-ready Soroban smart contract for Acredia's credential issuance and verification system on Stellar Network.

**Before deploying to mainnet**, read [MAINNET_CHECKLIST.md](./MAINNET_CHECKLIST.md) (owner-key custody, upgrade governance, TTL/keeper strategy, event coverage, error taxonomy, third-party audit) and [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) (internal security review findings and their resolution status).

### AcrediaCredential Contract (`src/lib.rs`)

Single unified contract combining credential issuance, registry, and verification:

**Core Responsibilities**:
1. **Issuance**: Authorize institutions and issue credentials
2. **Storage**: Immutable on-chain credential storage
3. **Verification**: Public credential verification by hash
4. **Management**: Revocation and issuer authorization control

**Key Functions**:
- `__constructor(owner)` - Runs once, atomically, at deploy time and sets the owner (there is no `initialize`)
- `get_owner()` - Read the current contract owner
- `get_pending_owner()` - Read the pending owner awaiting acceptance
- `transfer_owner(new_owner)` - Propose a two-step ownership transfer
- `accept_owner()` - Accept a pending ownership transfer
- `authorize_issuer(issuer)` - Authorize an institution to issue
- `revoke_issuer(issuer)` - Revoke institution authorization
- `is_authorized_issuer(issuer)` - Check authorization status
- `issue_credential(student, issuer, hash, expires_at)` - Issue a credential; only the hash is stored on-chain, `expires_at` is an optional Unix timestamp fixed at issuance
- `revoke_credential(token_id, issuer)` - Revoke issued credential (by its issuer)
- `admin_revoke_credential(token_id)` - Owner override to revoke any credential for compromised-issuer incident response (Owner only)
- `get_credential(token_id)` - Get credential by ID
- `verify_credential(hash)` - Verify credential by hash
- `is_revoked(token_id)` - Check revocation status
- `credential_status(token_id)` - `Valid`, `Revoked`, `Expired` or `NotFound` in one call (`Revoked` wins over `Expired`)
- `total_credentials()` - Get total credentials issued
- `bump_credential(token_id)` - Extend TTL of a credential (permissionless)
- `propose_upgrade(new_wasm_hash)` - Propose a WASM upgrade, starting the timelock (Owner only)
- `upgrade(new_wasm_hash)` - Execute a proposed upgrade after the timelock elapses (Owner only)
- `cancel_upgrade()` - Abandon a pending upgrade proposal (Owner only)
- `get_pending_upgrade()` - Read the pending upgrade proposal, if any
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
   cargo install --locked stellar-cli
   ```

3. **Stellar Account**
   ```bash
   stellar keys generate admin --network testnet
   stellar keys fund admin --network testnet
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
stellar keys generate admin --network testnet

# Fund account with testnet XLM
stellar keys fund admin --network testnet

# Verify account
stellar keys address admin
```

### Step 2: Build Contract

```bash
cargo build --target wasm32v1-none --release
```

### Step 3: Deploy to Stellar Testnet (sets the owner)

The owner is set by the contract's `__constructor`, which runs **atomically in
the deploy transaction**, so nobody can claim ownership between deploy and
setup ([SECURITY_AUDIT.md](./SECURITY_AUDIT.md) F-1). Constructor arguments go
after `--`:

```bash
OWNER_ADDR=<the owner account, e.g. the multisig account G...>

stellar contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source admin \
  --network testnet \
  -- \
  --owner $OWNER_ADDR
```

**Save the contract ID** from output (format: `CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)

### Step 4: Verify the Owner Immediately

The constructor deliberately does not require the owner's signature (the owner
is a multisig account, and requiring it would mean collecting multisig
signatures on the deploy itself). So check the owner **before doing anything
else**:

```bash
stellar contract invoke --id <CONTRACT_ID> --source admin --network testnet -- get_owner
```

It must print exactly `$OWNER_ADDR`. If it does not, discard this contract and
deploy again: nothing has been issued yet, so a fresh deploy costs nothing.

### Step 4b: Transfer Ownership Safely (Optional)

Ownership transfers use a two-step flow:

1. Current owner proposes a new owner:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  transfer_owner \
  --new_owner <NEW_OWNER_ADDRESS>
```

2. Pending owner accepts ownership:

```bash
stellar contract invoke \
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

# Deploy to Stellar Mainnet. The owner MUST be the multisig account
# (docs/owner-key-custody.md); verify it with get_owner right after (Step 4).
stellar contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source admin \
  --network public \
  -- \
  --owner <MULTISIG_OWNER_ADDRESS>
```

Update `frontend/.env`:
```env
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://mainnet.sorobanrpc.com
```

## Contract Operations

### Authorize an Issuer (Institution)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  authorize_issuer \
  --issuer <INSTITUTION_ADDRESS>
```

### Revoke an Issuer (Institution)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  revoke_issuer \
  --issuer <INSTITUTION_ADDRESS>
```

Important semantics:
- `authorize_issuer` and `revoke_issuer` are idempotent: repeating one succeeds
  and emits no second event.
- `revoke_issuer` only prevents that institution from issuing new credentials.
- Previously issued credentials remain stored immutably and remain verifiable.
- Revoking an issuer does not retroactively invalidate or alter older credentials.
- The verify UI surfaces the issuer authorization state explicitly so verifiers can see whether the issuer is currently authorized.

### Issue a Credential

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <INSTITUTION_ADDRESS> \
  --network testnet \
  -- \
  issue_credential \
  --student <STUDENT_ADDRESS> \
  --issuer <INSTITUTION_ADDRESS> \
  --credential_hash "<64_CHAR_SHA256_HEX_DIGEST>"
```

Add `--expires_at <UNIX_SECONDS>` for a credential that expires; it must be in
the future, and it cannot be changed after issuance. Only the hash is stored
on-chain; the credential's content stays off-chain (no IPFS URI).

### Verify Credential

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  verify_credential \
  --credential_hash "<64_CHAR_SHA256_HEX_DIGEST>"
```

### Check Revocation Status

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  is_revoked \
  --token_id 1
```

### Revoke a Credential

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <INSTITUTION_ADDRESS> \
  --network testnet \
  -- \
  revoke_credential \
  --token_id 1 \
  --issuer <INSTITUTION_ADDRESS>
```

### Platform (Owner) Revocation Override

By default only the institution that issued a credential can revoke it. `admin_revoke_credential`
adds a narrow owner-gated override for one scenario the issuer-only path cannot handle: an issuer's
signing key is compromised or lost, so a specific bad credential can no longer be revoked by the
address that issued it.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  admin_revoke_credential \
  --token_id 1
```

**Public guarantee — the platform revokes only in the open.** A platform-initiated revocation emits
a **distinct** `credential_revoked_by_owner` event (never the issuer path's `credential_revoked`). The off-chain indexer
records which path revoked each credential (`revocation_source`: `issuer` vs `platform`), and the
public verification API and verify page surface that distinction to every verifier. The owner can
revoke a credential over an institution's head, but can never do so silently or while masquerading
as the institution's own revocation. See
[docs/decisions/0004-owner-credential-revocation-override.md](../docs/decisions/0004-owner-credential-revocation-override.md)
and [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) F-5.

## Contract Verification

View deployed contracts on Stellar Expert:

- **Testnet**: https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>
- **Mainnet**: https://stellar.expert/explorer/public/contract/<CONTRACT_ID>

## Troubleshooting

### Build Errors
- **Solution**: Update Rust: `rustup update`
- **Solution**: Install the Stellar CLI: `cargo install --locked stellar-cli`

### Deployment Fails
- **Check**: Account has XLM for fees: the `admin` account on Stellar Expert (`stellar keys address admin` prints it)
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
Only the contract `Owner` can propose, cancel, or execute an upgrade. Every step calls `owner.require_auth()` to prevent unauthorized code updates.

### Upgrade Policy (on-chain timelock)

Upgrades are **timelocked and announced on-chain**. An upgrade cannot take effect the moment the owner decides to run it; it must first be proposed, and then it can only be executed after a fixed delay has elapsed. This gives credential holders and third-party verifiers a public, fixed window to inspect exactly which code is about to run before it can replace the live contract.

- **Two-step flow**: `propose_upgrade(new_wasm_hash)` records the target WASM hash and emits an `upgrade_proposed` event; `upgrade(new_wasm_hash)` executes it. `upgrade` succeeds only when a matching proposal exists, the supplied hash equals the proposed hash, and the timelock has elapsed — otherwise it fails with `UpgradeNotProposed`, `UpgradeHashMismatch`, or `UpgradeTimelockActive` and changes nothing.
- **Timelock window**: `UPGRADE_TIMELOCK_LEDGERS = 120_960` ledgers (~7 days at 5 s/ledger) between proposal and earliest execution.
- **Hash commitment**: the proposal commits to a specific WASM hash. The executing call must present the same hash, so the code that ships is exactly the code that was announced — a proposal cannot be swapped for different code at execution time.
- **Announcement & transparency**: the pending proposal (target hash + earliest-execution ledger) is emitted as `upgrade_proposed` and is readable on-chain at any time via `get_pending_upgrade`.
- **Cancellation**: `cancel_upgrade` (owner-gated, emits `upgrade_cancelled`) abandons a pending proposal, e.g. if a mistake or a better fix is found before the window elapses.
- **Recommendations for Production**: on top of this timelock, it is recommended that the `Owner` address is a multi-signature account (e.g. Stellar's native multi-sig or a smart-contract multisig wallet) so that proposing and executing an upgrade also requires a threshold of signers.

Rationale and the choice of window are recorded in [docs/decisions/0005-upgrade-timelock.md](../docs/decisions/0005-upgrade-timelock.md).

### Upgrade Procedure
To update an **existing** contract ID, first confirm the currently deployed
interface and owner. Local source files do not change code already on the
ledger. A newly deployed instance gets its owner from the constructor at deploy
time; an in-place upgrade
keeps the existing address and storage. Use a disposable testnet contract for
the first full rehearsal.

The commands below apply **only after the currently deployed contract already
exposes** `propose_upgrade` and `get_pending_upgrade`. Inspect it first:

```bash
stellar contract info interface --network testnet --contract-id <CONTRACT_ID>
```

If those functions are absent, the deployed contract is an older version. Its
old `upgrade` entrypoint controls the transition to this timelocked version;
the new timelock cannot govern code that has not been installed yet. Review
that on-chain interface, storage compatibility and owner authorization before
any upgrade, and record the one-time bootstrap transition. A fresh isolated
testnet deployment is the safer route for testing this checkout.

1. **Build and upload the new WASM without creating another contract instance**:
   ```bash
   cd contracts
   cargo build --target wasm32v1-none --release
   stellar contract upload \
     --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
     --source admin \
     --network testnet
   ```
   Record the returned WASM hash. `stellar contract deploy --wasm ...`
   creates a **new contract ID**; it is not an in-place upgrade.

2. **Propose the Upgrade** (starts the timelock and publishes the announcement):
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- \
     propose_upgrade \
     --new_wasm_hash "<NEW_WASM_HASH>"
   ```
   Anyone can read the pending proposal (target hash and earliest-execution ledger) with `get_pending_upgrade`.

3. **Wait for the timelock** (~7 days / 120,960 ledgers) to elapse.

4. **Execute the Upgrade** (only succeeds after the window, and only for the proposed hash):
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- \
     upgrade \
     --new_wasm_hash "<NEW_WASM_HASH>"
   ```
   To abandon a proposal before executing it, call `cancel_upgrade`.

5. **Schema / State Migration** (If applicable):
   If the new WASM version introduces changes to the storage structures, run the migration function:
   ```bash
   stellar contract invoke \
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
   stellar contract invoke \
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

> **Note:** the on-chain record holds only the credential hash; there is no
> IPFS URI (review §3.11). The credential's content is stored privately
> off-chain, so the TTL keeper above is the only keeper this contract needs.

## Events

Every state-changing entrypoint publishes an event so off-chain indexers and monitoring never
have to poll contract state to detect a change. Topics are listed in publish order; `data` is the
event payload.

| First topic (+ indexed topics) | Emitted by | Data fields |
|---|---|---|
| `initialized` | constructor (deploy) | `owner` |
| `owner_transfer_proposed` (+ `owner`) | `transfer_owner` | `new_owner` |
| `owner_transfer_accepted` (+ `previous_owner`) | `accept_owner` | `new_owner` |
| `issuer_authorized` (+ `issuer`) | `authorize_issuer` (only when it changes state) | none |
| `issuer_revoked` (+ `issuer`) | `revoke_issuer` (only when it changes state) | none |
| `issuer_profile_updated` (+ `issuer`) | `set_issuer_profile` | `name`, `profile_uri`, `updated_at` |
| `credential_issued` (+ `token_id`) | `issue_credential`, each row of `batch_issue_credential` | `student`, `issuer`, `credential_hash`, `expires_at` |
| `batch_issued` (+ `issuer`) | `batch_issue_credential` | `requested`, `issued` |
| `credential_revoked` (+ `token_id`) | `revoke_credential` | `issuer` |
| `credential_revoked_by_owner` (+ `token_id`) | `admin_revoke_credential` | `owner` |
| `paused` | `pause` | none |
| `unpaused` | `unpause` | none |
| `upgrade_proposed` | `propose_upgrade` | `wasm_hash`, `ready_ledger` |
| `upgrade_cancelled` | `cancel_upgrade` | none |
| `upgraded` | `upgrade` | `wasm_hash` |
| `migrated` (+ `from_version`) | `migrate` | `to_version` |

Events are typed with `#[contractevent]`: the first topic is the event name, then the indexed
fields marked `(+ …)`; the data is a map keyed by field name, so readers decode by name and new
fields can be added without breaking them.

`bump_credential`, all read-only getters (`get_owner`, `verify_credential`, `is_revoked`,
`get_pending_upgrade`, …), and `get_pending_owner` do not emit events — they don't change state.

## Error Taxonomy

All fallible entrypoints return `Result<T, ContractError>`. Codes are never renumbered or reused;
codes **1** (`AlreadyInitialized`, there is no `initialize`) and **17** (`IpfsUriTooLarge`, there is
no URI) are retired.

| Variant | Code | Meaning | Returned by |
|---|---|---|---|
| `IssuerNotAuthorized` | 2 | Caller of `issue_credential` / `batch_issue_credential` is not a currently-authorized issuer; also `set_issuer_profile` for an unauthorized issuer | `issue_credential`, `batch_issue_credential`, `set_issuer_profile` |
| `CredentialAlreadyExists` | 3 | `credential_hash` is already indexed by another credential | `issue_credential`, per row in `batch_issue_credential` |
| `CredentialNotFound` | 4 | `token_id` does not exist (or has been archived and not yet restored) | `get_credential`, `revoke_credential`, `admin_revoke_credential`, `bump_credential` |
| `AlreadyRevoked` | 5 | Credential is already marked revoked | `revoke_credential`, `admin_revoke_credential` |
| `UnauthorizedRevoker` | 6 | Caller is not the address recorded as the credential's issuer (checked *before* `AlreadyRevoked` — see `SECURITY_AUDIT.md`) | `revoke_credential` |
| `NotInitialized` | 7 | The owner record is missing from storage. Cannot happen in a contract deployed with this code (the constructor sets it); kept as a typed failure instead of an opaque panic | any owner-gated entrypoint |
| `SameOwner` | 8 | `transfer_owner` called with the current owner's own address | `transfer_owner` |
| `NoPendingOwner` | 9 | `accept_owner` called with no transfer in progress | `accept_owner` |
| `ContractPaused` | 10 | State-changing call attempted while the contract is paused | `issue_credential`, `batch_issue_credential`, `revoke_credential`, `admin_revoke_credential` |
| `BatchTooLarge` | 11 | More than `MAX_BATCH_SIZE` rows | `batch_issue_credential` |
| `EmptyBatch` | 12 | No rows | `batch_issue_credential` |
| `ProfileTooLarge` | 13 | Issuer name or profile URI over its length cap | `set_issuer_profile` |
| `UpgradeNotProposed` | 14 | No pending upgrade | `upgrade`, `cancel_upgrade` |
| `UpgradeHashMismatch` | 15 | WASM hash differs from the proposed one | `upgrade` |
| `UpgradeTimelockActive` | 16 | Timelock has not elapsed | `upgrade` |
| `InvalidExpiry` | 18 | `expires_at` is not after the ledger time at issuance | `issue_credential`, per row in `batch_issue_credential` |

Beyond `ContractError`, calls can also fail at the host level with an authorization error (no
matching `require_auth`) before ever reaching contract logic — this is not a `ContractError`
variant and is not returned as a typed `Err`; it surfaces as a transaction/simulation failure.
Every entrypoint that requires authorization has an explicit test proving this
(`test_*_requires_owner_auth` in `src/lib.rs`).

## Security Notes

⚠️ **Critical**:
- Never commit private keys or secrets
- Always use separate accounts for testnet and mainnet
- Complete every item in [MAINNET_CHECKLIST.md](./MAINNET_CHECKLIST.md) — including an
  independent third-party audit — before mainnet deployment; see
  [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for the internal review this project starts from
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

For any questions or suggestions, open an issue on the [GitHub repository](https://github.com/soumen0818/ACREDIA-STELLAR) or refer to the [Stellar Developers documentation](https://developers.stellar.org/).
