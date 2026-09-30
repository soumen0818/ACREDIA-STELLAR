#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// TTL / archival constants
//
// Soroban protocol-26 limits (both testnet and mainnet):
//   max_entry_ttl          = 6_312_000 ledgers  (~1 year at 5 s/ledger)
//   min_persistent_entry_ttl = 4_096 ledgers
//
// Strategy:
//   • PERSISTENT_BUMP_AMOUNT   – extend to 1 year every write / bump call.
//   • PERSISTENT_THRESHOLD     – only re-extend when fewer than ~6 months remain,
//                                so a bump call costs a fee only when it matters.
//   • INSTANCE_BUMP_AMOUNT     – keep instance storage alive for 1 year.
//   • INSTANCE_THRESHOLD       – re-extend instance when < 6 months remain.
// ---------------------------------------------------------------------------
const PERSISTENT_BUMP_AMOUNT: u32 = 6_312_000; // ~1 year
const PERSISTENT_THRESHOLD: u32 = 3_110_400; // ~6 months  (re-extend trigger)
const INSTANCE_BUMP_AMOUNT: u32 = 6_312_000;
const INSTANCE_THRESHOLD: u32 = 3_110_400;

// Maximum number of credentials accepted per `batch_issue_credential` call.
// Each successful row writes two persistent entries (Credential + HashIndex),
// on top of the shared NextTokenId/TotalCredentials writes for the whole
// call. This isn't just a guess: the soroban-env-host test harness
// (`cargo test`) actually simulates real network resource limits, and 25
// items measurably exceeds them — "write ledger entries: 53 > 50, total
// footprint ledger entries: 109 > 100" (see
// `test_batch_issue_at_max_size_boundary_succeeds`, which pins this value by
// asserting a full batch at MAX_BATCH_SIZE succeeds under simulation). 20
// keeps a comfortable margin under both ceilings while still cutting
// signature/latency overhead by 20x versus one-by-one issuance. Callers with
// larger CSVs are expected to split into multiple `batch_issue_credential`
// calls (chunks). Revisit this number if the persistent-entry TTL-bump
// overhead changes, or against measured mainnet resource costs (see
// MAINNET_CHECKLIST.md).
const MAX_BATCH_SIZE: u32 = 20;

// Issuer profile size caps (see IssuerProfile) — kept small and fixed so an
// issuer's identity binding stays a cheap, bounded-size persistent entry
// rather than an open-ended storage/TTL liability.
const MAX_ISSUER_NAME_LEN: u32 = 64;
const MAX_ISSUER_PROFILE_URI_LEN: u32 = 256;

const UPGRADE_TIMELOCK_LEDGERS: u32 = 120_960;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    IssuerNotAuthorized = 2,
    CredentialAlreadyExists = 3,
    CredentialNotFound = 4,
    AlreadyRevoked = 5,
    UnauthorizedRevoker = 6,
    NotInitialized = 7,
    SameOwner = 8,
    NoPendingOwner = 9,
    ContractPaused = 10,
    BatchTooLarge = 11,
    EmptyBatch = 12,
    ProfileTooLarge = 13,
    UpgradeNotProposed = 14,
    UpgradeHashMismatch = 15,
    UpgradeTimelockActive = 16,
}

#[contracttype]
pub enum DataKey {
    Initialized,
    Owner,
    PendingOwner,
    NextTokenId,
    Authorized(Address),
    Credential(u64),
    HashIndex(BytesN<32>),
    TotalCredentials,
    StorageVersion,
    Paused,
    IssuerProfile(Address),
    PendingUpgrade,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Credential {
    pub token_id: u64,
    pub student: Address,
    pub issuer: Address,
    pub credential_hash: BytesN<32>,
    pub ipfs_hash: String,
    pub issued_at: u64,
    pub revoked: bool,
}

/// A single row of a `batch_issue_credential` call. The issuer is shared
/// across the whole batch (see `batch_issue_credential`), so it is not
/// repeated per row.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCredentialInput {
    pub student: Address,
    pub credential_hash: BytesN<32>,
    pub ipfs_uri: String,
}

/// Per-row outcome of a `batch_issue_credential` call. Plain primitives are
/// used instead of `Option<ContractError>` so the shape stays simple and
/// unambiguous to decode off-chain: `token_id` is `0` (never a real token id,
/// which starts at 1) when `success` is `false`, and `error_code` mirrors a
/// `ContractError as u32` value when `success` is `false`, else `0`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchIssueResult {
    pub index: u32,
    pub success: bool,
    pub token_id: u64,
    pub error_code: u32,
}

/// Minimal on-chain binding from an authorized issuer's address to a
/// human-readable identity. `name` is a short display handle read directly
/// from chain state (no off-chain fetch needed for a quick trust check);
/// `profile_uri` optionally points to a richer, off-chain-signed issuer
/// profile document (e.g. an `ipfs://` URI) for deeper verification —
/// mirrors how `Credential.ipfs_hash` anchors a credential's own metadata.
/// Both fields are length-capped (see MAX_ISSUER_NAME_LEN /
/// MAX_ISSUER_PROFILE_URI_LEN) to keep per-issuer storage/TTL cost small.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerProfile {
    pub name: String,
    pub profile_uri: String,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub ready_ledger: u32,
}

#[contract]
pub struct AcrediaCredential;

fn require_initialized(env: &Env) {
    let initialized = env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false);

    if !initialized {
        panic!("ContractError({})", ContractError::NotInitialized as u32);
    }
}

fn read_owner(env: &Env) -> Address {
    require_initialized(env);
    env.storage().instance().get(&DataKey::Owner).unwrap()
}

/// Extend the instance storage TTL so Owner/Authorized/NextTokenId are never
/// archived.  Called at the top of every public entry point.
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

/// Extend the TTL for a single persistent `Credential` entry and its
/// corresponding `HashIndex` entry (looked-up by token_id via the credential).
fn extend_credential_ttl(env: &Env, token_id: u64, credential_hash: &BytesN<32>) {
    env.storage().persistent().extend_ttl(
        &DataKey::Credential(token_id),
        PERSISTENT_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
    env.storage().persistent().extend_ttl(
        &DataKey::HashIndex(credential_hash.clone()),
        PERSISTENT_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Extend the TTL of the TotalCredentials counter.
fn extend_total_credentials_ttl(env: &Env) {
    env.storage().persistent().extend_ttl(
        &DataKey::TotalCredentials,
        PERSISTENT_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Extend the TTL of a single issuer's profile entry.
fn extend_issuer_profile_ttl(env: &Env, issuer: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::IssuerProfile(issuer.clone()),
        PERSISTENT_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

fn contract_is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

/// Checks if an issuer is authorized, handles TTL extension for persistent storage,
/// and transparently migrates existing instance-based authorizations to persistent storage.
fn check_and_extend_authorization(env: &Env, issuer: &Address) -> bool {
    // 1. Check persistent storage (new behavior)
    if let Some(authorized) = env
        .storage()
        .persistent()
        .get::<_, bool>(&DataKey::Authorized(issuer.clone()))
    {
        if authorized {
            env.storage().persistent().extend_ttl(
                &DataKey::Authorized(issuer.clone()),
                PERSISTENT_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
        return authorized;
    }

    // 2. Fallback to instance storage (for existing deployments)
    if let Some(authorized) = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Authorized(issuer.clone()))
    {
        if authorized {
            // Migrate to persistent
            env.storage()
                .persistent()
                .set(&DataKey::Authorized(issuer.clone()), &true);
            env.storage().persistent().extend_ttl(
                &DataKey::Authorized(issuer.clone()),
                PERSISTENT_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
            // Clean up instance storage
            env.storage()
                .instance()
                .remove(&DataKey::Authorized(issuer.clone()));
        }
        return authorized;
    }

    false
}

#[contractimpl]
#[allow(deprecated)]
impl AcrediaCredential {
    pub fn initialize(env: Env, owner: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(ContractError::AlreadyInitialized);
        }
        // Require the proposed owner's signature so initialize cannot be
        // front-run into setting an address the caller does not control
        // (which would permanently brick the contract). This does not by
        // itself prevent front-running of *which* address becomes owner —
        // deploy and initialize must still be submitted as a single atomic
        // transaction for that. See contracts/SECURITY_AUDIT.md (F-1).
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextTokenId, &1u64);
        extend_instance_ttl(&env);
        env.events().publish((symbol_short!("init"),), owner);
        Ok(())
    }

    pub fn get_owner(env: Env) -> Address {
        extend_instance_ttl(&env);
        read_owner(&env)
    }

    pub fn get_pending_owner(env: Env) -> Option<Address> {
        require_initialized(&env);
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::PendingOwner)
    }

    pub fn transfer_owner(env: Env, new_owner: Address) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();

        if owner == new_owner {
            return Err(ContractError::SameOwner);
        }

        env.storage()
            .instance()
            .set(&DataKey::PendingOwner, &new_owner.clone());
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("own_xfer"), owner), new_owner);

        Ok(())
    }

    pub fn accept_owner(env: Env) -> Result<(), ContractError> {
        let previous_owner = read_owner(&env);
        let pending_owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingOwner)
            .ok_or(ContractError::NoPendingOwner)?;

        pending_owner.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Owner, &pending_owner.clone());
        env.storage().instance().remove(&DataKey::PendingOwner);
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("own_acpt"), previous_owner), pending_owner);

        Ok(())
    }

    pub fn authorize_issuer(env: Env, issuer: Address) {
        let owner = read_owner(&env);
        owner.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Authorized(issuer.clone()), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::Authorized(issuer.clone()),
            PERSISTENT_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
        env.storage()
            .instance()
            .remove(&DataKey::Authorized(issuer.clone())); // Cleanup existing
        extend_instance_ttl(&env);
        env.events().publish((symbol_short!("iss_auth"),), issuer);
    }

    /// Revoke an issuer's permission to issue new credentials.
    ///
    /// This does not mutate previously issued credentials. Existing credentials
    /// remain verifiable and keep their original issuance metadata, while the
    /// issuer is simply prevented from issuing new credentials in the future.
    pub fn revoke_issuer(env: Env, issuer: Address) {
        let owner = read_owner(&env);
        owner.require_auth();

        let in_persistent = env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Authorized(issuer.clone()))
            .unwrap_or(false);
        let in_instance = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Authorized(issuer.clone()))
            .unwrap_or(false);
        let was_authorized = in_persistent || in_instance;

        if was_authorized {
            env.storage()
                .persistent()
                .remove(&DataKey::Authorized(issuer.clone()));
            env.storage()
                .instance()
                .remove(&DataKey::Authorized(issuer.clone()));
            env.events().publish((symbol_short!("iss_rev"),), issuer);
        }

        extend_instance_ttl(&env);
    }

    pub fn is_authorized_issuer(env: Env, issuer: Address) -> bool {
        require_initialized(&env);
        extend_instance_ttl(&env);
        check_and_extend_authorization(&env, &issuer)
    }

    /// Publish or update the calling issuer's minimal on-chain identity
    /// binding. Self-service by design (the issuer signs, not the owner) —
    /// authorization (who *can* issue) and profile (how they *identify*) are
    /// deliberately separate concerns. Requires the caller to be currently
    /// authorized, so profile storage can't be spammed by arbitrary
    /// addresses. Revoking an issuer's authorization does not clear their
    /// profile (see revoke_issuer) — past credentials should still resolve
    /// to the identity that issued them — it just blocks further updates
    /// until re-authorized.
    pub fn set_issuer_profile(
        env: Env,
        issuer: Address,
        name: String,
        profile_uri: String,
    ) -> Result<(), ContractError> {
        issuer.require_auth();

        if !check_and_extend_authorization(&env, &issuer) {
            return Err(ContractError::IssuerNotAuthorized);
        }

        if name.len() > MAX_ISSUER_NAME_LEN || profile_uri.len() > MAX_ISSUER_PROFILE_URI_LEN {
            return Err(ContractError::ProfileTooLarge);
        }

        let updated_at = env.ledger().timestamp();
        let profile = IssuerProfile {
            name: name.clone(),
            profile_uri: profile_uri.clone(),
            updated_at,
        };

        env.storage()
            .persistent()
            .set(&DataKey::IssuerProfile(issuer.clone()), &profile);
        extend_issuer_profile_ttl(&env, &issuer);
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("iss_prof"), issuer),
            (name, profile_uri, updated_at),
        );

        Ok(())
    }

    /// Resolve an issuer address to its on-chain identity binding, if any
    /// has been published. Returns `None` for an issuer that never called
    /// `set_issuer_profile` — this is a distinct, weaker state than "not
    /// authorized" (an authorized issuer may simply not have a profile yet).
    pub fn get_issuer_profile(env: Env, issuer: Address) -> Option<IssuerProfile> {
        extend_instance_ttl(&env);
        let profile: IssuerProfile = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerProfile(issuer.clone()))?;
        extend_issuer_profile_ttl(&env, &issuer);
        Some(profile)
    }

    pub fn issue_credential(
        env: Env,
        student: Address,
        issuer: Address,
        credential_hash: BytesN<32>,
        ipfs_uri: String,
    ) -> Result<u64, ContractError> {
        issuer.require_auth();

        if contract_is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        if !check_and_extend_authorization(&env, &issuer) {
            return Err(ContractError::IssuerNotAuthorized);
        }

        if ipfs_uri.len() > MAX_IPFS_URI_LEN {
            return Err(ContractError::IpfsUriTooLarge);
        }

        // Reject duplicate hashes to prevent index overwrite.
        if env
            .storage()
            .persistent()
            .has(&DataKey::HashIndex(credential_hash.clone()))
        {
            return Err(ContractError::CredentialAlreadyExists);
        }

        let token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(1u64);

        let credential = Credential {
            token_id,
            student: student.clone(),
            issuer: issuer.clone(),
            credential_hash: credential_hash.clone(),
            ipfs_hash: ipfs_uri.clone(),
            issued_at: env.ledger().timestamp(),
            revoked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Credential(token_id), &credential);
        env.storage()
            .persistent()
            .set(&DataKey::HashIndex(credential_hash.clone()), &token_id);

        // Extend TTL on every write so credentials survive long-term.
        extend_credential_ttl(&env, token_id, &credential_hash);

        env.storage()
            .instance()
            .set(&DataKey::NextTokenId, &(token_id + 1));

        let current: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalCredentials)
            .unwrap_or(0u64);
        env.storage()
            .persistent()
            .set(&DataKey::TotalCredentials, &(current + 1));
        extend_total_credentials_ttl(&env);

        // Keep instance storage alive too.
        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("cred_iss"), token_id),
            (student, issuer, credential_hash, ipfs_uri),
        );

        Ok(token_id)
    }

    /// Issue up to `MAX_BATCH_SIZE` credentials from a single issuer in one
    /// call/signature. Unlike `issue_credential`, a bad row (e.g. a duplicate
    /// hash) does not fail the whole call: it is recorded as a failed
    /// `BatchIssueResult` and the remaining rows are still attempted, so
    /// callers get clear per-row success/failure instead of an all-or-nothing
    /// transaction. Only whole-batch problems (unauthenticated/unauthorized
    /// issuer, paused contract, empty batch, batch too large) fail the call
    /// itself via `Result::Err`.
    pub fn batch_issue_credential(
        env: Env,
        issuer: Address,
        credentials: Vec<BatchCredentialInput>,
    ) -> Result<Vec<BatchIssueResult>, ContractError> {
        issuer.require_auth();

        if contract_is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        if !check_and_extend_authorization(&env, &issuer) {
            return Err(ContractError::IssuerNotAuthorized);
        }

        if credentials.is_empty() {
            return Err(ContractError::EmptyBatch);
        }

        if credentials.len() > MAX_BATCH_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        let mut results: Vec<BatchIssueResult> = Vec::new(&env);
        // Hashes issued earlier in this same batch — duplicates against these
        // wouldn't yet be visible via `storage().persistent().has(...)`.
        let mut seen_hashes: Vec<BytesN<32>> = Vec::new(&env);

        let mut next_token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(1u64);
        let mut issued_count: u64 = 0;

        for (i, input) in credentials.iter().enumerate() {
            let index = i as u32;

            if input.ipfs_uri.len() > MAX_IPFS_URI_LEN {
                results.push_back(BatchIssueResult {
                    index,
                    success: false,
                    token_id: 0,
                    error_code: ContractError::IpfsUriTooLarge as u32,
                });
                continue;
            }

            let mut duplicate = env
                .storage()
                .persistent()
                .has(&DataKey::HashIndex(input.credential_hash.clone()));
            if !duplicate {
                for seen in seen_hashes.iter() {
                    if seen == input.credential_hash {
                        duplicate = true;
                        break;
                    }
                }
            }

            if duplicate {
                results.push_back(BatchIssueResult {
                    index,
                    success: false,
                    token_id: 0,
                    error_code: ContractError::CredentialAlreadyExists as u32,
                });
                continue;
            }

            let token_id = next_token_id;
            let credential = Credential {
                token_id,
                student: input.student.clone(),
                issuer: issuer.clone(),
                credential_hash: input.credential_hash.clone(),
                ipfs_hash: input.ipfs_uri.clone(),
                issued_at: env.ledger().timestamp(),
                revoked: false,
            };

            env.storage()
                .persistent()
                .set(&DataKey::Credential(token_id), &credential);
            env.storage().persistent().set(
                &DataKey::HashIndex(input.credential_hash.clone()),
                &token_id,
            );
            extend_credential_ttl(&env, token_id, &input.credential_hash);

            seen_hashes.push_back(input.credential_hash.clone());
            next_token_id += 1;
            issued_count += 1;

            env.events().publish(
                (symbol_short!("cred_iss"), token_id),
                (
                    input.student.clone(),
                    issuer.clone(),
                    input.credential_hash.clone(),
                    input.ipfs_uri.clone(),
                ),
            );

            results.push_back(BatchIssueResult {
                index,
                success: true,
                token_id,
                error_code: 0,
            });
        }

        if issued_count > 0 {
            env.storage()
                .instance()
                .set(&DataKey::NextTokenId, &next_token_id);

            let current: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalCredentials)
                .unwrap_or(0u64);
            env.storage()
                .persistent()
                .set(&DataKey::TotalCredentials, &(current + issued_count));
            extend_total_credentials_ttl(&env);
        }

        extend_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("batch_is"), issuer),
            (credentials.len(), issued_count as u32),
        );

        Ok(results)
    }

    pub fn revoke_credential(
        env: Env,
        token_id: u64,
        issuer: Address,
    ) -> Result<(), ContractError> {
        issuer.require_auth();

        if contract_is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        let mut credential: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Credential(token_id))
            .ok_or(ContractError::CredentialNotFound)?;

        if credential.issuer != issuer {
            return Err(ContractError::UnauthorizedRevoker);
        }
        if credential.revoked {
            return Err(ContractError::AlreadyRevoked);
        }

        credential.revoked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Credential(token_id), &credential);

        // Extend TTL even on revocation — a revoked credential must remain
        // readable so verifiers know it was revoked (not just missing).
        extend_credential_ttl(&env, token_id, &credential.credential_hash);
        extend_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("cred_rev"), token_id), issuer);

        Ok(())
    }

    pub fn admin_revoke_credential(env: Env, token_id: u64) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();

        if contract_is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        let mut credential: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Credential(token_id))
            .ok_or(ContractError::CredentialNotFound)?;

        if credential.revoked {
            return Err(ContractError::AlreadyRevoked);
        }

        credential.revoked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Credential(token_id), &credential);

        extend_credential_ttl(&env, token_id, &credential.credential_hash);
        extend_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "cred_rev_owner"), token_id), owner);

        Ok(())
    }

    pub fn get_credential(env: Env, token_id: u64) -> Result<Credential, ContractError> {
        let credential: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Credential(token_id))
            .ok_or(ContractError::CredentialNotFound)?;
        // Extend on every read — anyone requesting a credential implicitly
        // signals it is still needed.
        extend_credential_ttl(&env, token_id, &credential.credential_hash);
        extend_instance_ttl(&env);
        Ok(credential)
    }

    pub fn verify_credential(env: Env, credential_hash: BytesN<32>) -> Option<Credential> {
        let token_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::HashIndex(credential_hash.clone()))?;
        let credential: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Credential(token_id))?;
        extend_credential_ttl(&env, token_id, &credential_hash);
        extend_instance_ttl(&env);
        Some(credential)
    }

    pub fn is_revoked(env: Env, token_id: u64) -> bool {
        extend_instance_ttl(&env);
        let maybe: Option<Credential> = env
            .storage()
            .persistent()
            .get::<DataKey, Credential>(&DataKey::Credential(token_id));
        if let Some(ref c) = maybe {
            env.storage().persistent().extend_ttl(
                &DataKey::Credential(token_id),
                PERSISTENT_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
            c.revoked
        } else {
            false
        }
    }

    pub fn total_credentials(env: Env) -> u64 {
        require_initialized(&env);
        extend_instance_ttl(&env);
        let total = env
            .storage()
            .persistent()
            .get(&DataKey::TotalCredentials)
            .unwrap_or(0u64);
        if total > 0 {
            extend_total_credentials_ttl(&env);
        }
        total
    }

    /// Public bump entry-point so anyone can extend the TTL of any credential
    /// without modifying it.  This lets off-chain keepers (or the credential
    /// holder) ensure the data stays alive without requiring issuer authority.
    ///
    /// Returns `Err(CredentialNotFound)` when the token_id does not exist
    /// (including after it has been archived and not yet restored).
    pub fn bump_credential(env: Env, token_id: u64) -> Result<(), ContractError> {
        let credential: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Credential(token_id))
            .ok_or(ContractError::CredentialNotFound)?;
        extend_credential_ttl(&env, token_id, &credential.credential_hash);
        extend_total_credentials_ttl(&env);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Halt all state-changing entrypoints.  Reads and verification continue
    /// to work while paused so existing credentials remain verifiable.
    pub fn pause(env: Env) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        extend_instance_ttl(&env);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    /// Restore normal operation after an emergency pause.
    pub fn unpause(env: Env) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        extend_instance_ttl(&env);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        extend_instance_ttl(&env);
        contract_is_paused(&env)
    }

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();

        let ready_ledger = env
            .ledger()
            .sequence()
            .saturating_add(UPGRADE_TIMELOCK_LEDGERS);

        let pending = PendingUpgrade {
            wasm_hash: new_wasm_hash.clone(),
            ready_ledger,
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &pending);

        env.events()
            .publish((symbol_short!("upg_prop"),), (new_wasm_hash, ready_ledger));

        extend_instance_ttl(&env);
        Ok(())
    }

    pub fn get_pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::PendingUpgrade)
    }

    pub fn cancel_upgrade(env: Env) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();

        if !env.storage().instance().has(&DataKey::PendingUpgrade) {
            return Err(ContractError::UpgradeNotProposed);
        }

        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.events().publish((symbol_short!("upg_cncl"),), ());

        extend_instance_ttl(&env);
        Ok(())
    }

    /// Upgrade the contract to a new WebAssembly code using a WASM hash.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();

        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .ok_or(ContractError::UpgradeNotProposed)?;

        if pending.wasm_hash != new_wasm_hash {
            return Err(ContractError::UpgradeHashMismatch);
        }

        if env.ledger().sequence() < pending.ready_ledger {
            return Err(ContractError::UpgradeTimelockActive);
        }

        env.storage().instance().remove(&DataKey::PendingUpgrade);

        env.events()
            .publish((symbol_short!("upgraded"),), new_wasm_hash.clone());
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Get the current storage version.
    pub fn get_storage_version(env: Env) -> u32 {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::StorageVersion)
            .unwrap_or(1)
    }

    /// Migrate storage schema to the current version.
    pub fn migrate(env: Env) -> Result<(), ContractError> {
        let owner = read_owner(&env);
        owner.require_auth();
        extend_instance_ttl(&env);

        let current_version = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::StorageVersion)
            .unwrap_or(1);

        if current_version < 2 {
            // Perform schema / data migration logic here.
            // E.g., initializing/updating storage parameters, etc.
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &2u32);
            env.events()
                .publish((symbol_short!("migrated"), current_version), 2u32);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Register};
    use soroban_sdk::{vec, IntoVal, TryIntoVal, Val};

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        let issuer = Address::generate(&env);
        let student = Address::generate(&env);
        // initialize and authorize_issuer must be separate frames: both call
        // owner.require_auth(), and mock_all_auths() errors on a second
        // require_auth() for the same address within one synthetic frame.
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner.clone()).unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::authorize_issuer(env.clone(), issuer.clone());
        });
        (env, contract, owner, issuer, student)
    }

    fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    fn dummy_batch_input(env: &Env, seed: u8, student: &Address) -> BatchCredentialInput {
        BatchCredentialInput {
            student: student.clone(),
            credential_hash: dummy_hash(env, seed),
            ipfs_uri: String::from_str(env, "ipfs://batch"),
        }
    }

    fn last_event_topics(env: &Env) -> soroban_sdk::Vec<Val> {
        let events = env.events().all();
        let event = events.events().last().unwrap();
        match &event.body {
            soroban_sdk::xdr::ContractEventBody::V0(event) => {
                event.topics.clone().try_into_val(env).unwrap()
            }
        }
    }

    // Initialization

    #[test]
    fn test_initialize_once() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        env.as_contract(&contract, || {
            assert!(AcrediaCredential::initialize(env.clone(), owner.clone()).is_ok());
            assert_eq!(
                AcrediaCredential::initialize(env.clone(), owner),
                Err(ContractError::AlreadyInitialized)
            );
        });
    }

    // Issuance

    #[test]
    fn test_issue_and_verify() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 1);
        let ipfs = String::from_str(&env, "ipfs://test");

        env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer,
                hash.clone(),
                ipfs,
            )
            .unwrap();

            assert_eq!(token_id, 1);
            let cred = AcrediaCredential::verify_credential(env.clone(), hash).unwrap();
            assert_eq!(cred.token_id, 1);
            assert_eq!(cred.student, student);
        });
    }

    #[test]
    fn test_duplicate_hash_rejected() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 2);
        let ipfs = String::from_str(&env, "ipfs://a");

        env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer.clone(),
                hash.clone(),
                ipfs.clone(),
            )
            .unwrap();
        });

        env.as_contract(&contract, || {
            let result =
                AcrediaCredential::issue_credential(env.clone(), student, issuer, hash, ipfs);
            assert_eq!(result, Err(ContractError::CredentialAlreadyExists));
        });
    }

    #[test]
    fn property_duplicate_hash_rejected_across_seeded_inputs() {
        for seed in 0u8..12 {
            let (env, contract, _, issuer, student) = setup();
            let hash = dummy_hash(&env, seed.wrapping_add(32));
            let ipfs = String::from_str(&env, "ipfs://duplicate-property");

            env.as_contract(&contract, || {
                AcrediaCredential::issue_credential(
                    env.clone(),
                    student.clone(),
                    issuer.clone(),
                    hash.clone(),
                    ipfs.clone(),
                )
                .unwrap();
            });

            env.as_contract(&contract, || {
                let duplicate = AcrediaCredential::issue_credential(
                    env.clone(),
                    student.clone(),
                    issuer.clone(),
                    hash.clone(),
                    ipfs.clone(),
                );

                assert_eq!(duplicate, Err(ContractError::CredentialAlreadyExists));
            });
        }
    }

    #[test]
    fn test_unauthorized_issuer_rejected() {
        let (env, contract, _, _, student) = setup();
        let rogue = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                rogue,
                dummy_hash(&env, 3),
                String::from_str(&env, "ipfs://x"),
            );
            assert_eq!(result, Err(ContractError::IssuerNotAuthorized));
        });
    }

    #[test]
    fn test_issue_credential_at_ipfs_uri_boundary_succeeds() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 70);
        let uri = dummy_long_str(&env, MAX_IPFS_URI_LEN as usize);
        env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                hash.clone(),
                uri.clone(),
            )
            .unwrap();
            assert_eq!(token_id, 1);
            let cred = AcrediaCredential::verify_credential(env.clone(), hash).unwrap();
            assert_eq!(cred.ipfs_hash, uri);
        });
    }

    #[test]
    fn test_issue_credential_rejects_oversized_ipfs_uri() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let uri = dummy_long_str(&env, (MAX_IPFS_URI_LEN + 1) as usize);
            let result = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 71),
                uri,
            );
            assert_eq!(result, Err(ContractError::IpfsUriTooLarge));
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 0);
        });
    }

    // Batch issuance

    #[test]
    fn test_batch_issue_success() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                dummy_batch_input(&env, 40, &student),
                dummy_batch_input(&env, 41, &student),
                dummy_batch_input(&env, 42, &student),
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();

            assert_eq!(results.len(), 3);
            for i in 0..3u32 {
                let r = results.get(i).unwrap();
                assert!(r.success);
                assert_eq!(r.token_id, (i as u64) + 1);
                assert_eq!(r.error_code, 0);
            }
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 3);
        });
    }

    #[test]
    fn test_batch_issue_at_ipfs_uri_boundary_succeeds() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: dummy_hash(&env, 72),
                    ipfs_uri: dummy_long_str(&env, MAX_IPFS_URI_LEN as usize),
                },
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();
            assert_eq!(results.len(), 1);
            let r = results.get(0).unwrap();
            assert!(r.success);
            assert_eq!(r.token_id, 1);
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 1);
        });
    }

    #[test]
    fn test_batch_issue_rejects_oversized_ipfs_uri_row_others_succeed() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: dummy_hash(&env, 73),
                    ipfs_uri: dummy_long_str(&env, (MAX_IPFS_URI_LEN + 1) as usize),
                },
                BatchCredentialInput {
                    student,
                    credential_hash: dummy_hash(&env, 74),
                    ipfs_uri: String::from_str(&env, "ipfs://ok"),
                },
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();
            assert_eq!(results.len(), 2);

            let r0 = results.get(0).unwrap();
            assert!(!r0.success);
            assert_eq!(r0.token_id, 0);
            assert_eq!(r0.error_code, ContractError::IpfsUriTooLarge as u32);

            let r1 = results.get(1).unwrap();
            assert!(r1.success);
            assert_eq!(r1.token_id, 1);

            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 1);
        });
    }

    #[test]
    fn test_batch_issue_in_batch_duplicate_rejected_others_succeed() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let hash_a = dummy_hash(&env, 50);
            let hash_b = dummy_hash(&env, 51);
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: hash_a.clone(),
                    ipfs_uri: String::from_str(&env, "ipfs://a"),
                },
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: hash_a,
                    ipfs_uri: String::from_str(&env, "ipfs://a-dup"),
                },
                BatchCredentialInput {
                    student,
                    credential_hash: hash_b,
                    ipfs_uri: String::from_str(&env, "ipfs://b"),
                },
            ];

            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();
            assert_eq!(results.len(), 3);

            let r0 = results.get(0).unwrap();
            let r1 = results.get(1).unwrap();
            let r2 = results.get(2).unwrap();

            assert!(r0.success);
            assert_eq!(r0.token_id, 1);

            assert!(!r1.success);
            assert_eq!(r1.token_id, 0);
            assert_eq!(r1.error_code, ContractError::CredentialAlreadyExists as u32);

            // The failed row must not have consumed a token id.
            assert!(r2.success);
            assert_eq!(r2.token_id, 2);

            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 2);
        });
    }

    #[test]
    fn test_batch_issue_duplicate_against_existing_storage() {
        let (env, contract, _, issuer, student) = setup();
        let hash_a = dummy_hash(&env, 60);
        env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer.clone(),
                hash_a.clone(),
                String::from_str(&env, "ipfs://pre-existing"),
            )
            .unwrap();
        });

        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: hash_a,
                    ipfs_uri: String::from_str(&env, "ipfs://dup"),
                },
                BatchCredentialInput {
                    student,
                    credential_hash: dummy_hash(&env, 61),
                    ipfs_uri: String::from_str(&env, "ipfs://new"),
                },
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();

            assert!(!results.get(0).unwrap().success);
            let r1 = results.get(1).unwrap();
            assert!(r1.success);
            assert_eq!(r1.token_id, 2);
        });
    }

    #[test]
    fn test_batch_issue_exceeds_max_size_rejected() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let mut items: Vec<BatchCredentialInput> = Vec::new(&env);
            for seed in 0..(MAX_BATCH_SIZE + 1) {
                items.push_back(dummy_batch_input(&env, seed as u8, &student));
            }
            let result = AcrediaCredential::batch_issue_credential(env.clone(), issuer, items);
            assert_eq!(result, Err(ContractError::BatchTooLarge));
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 0);
        });
    }

    #[test]
    fn test_batch_issue_at_max_size_boundary_succeeds() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let mut items: Vec<BatchCredentialInput> = Vec::new(&env);
            for seed in 0..MAX_BATCH_SIZE {
                items.push_back(dummy_batch_input(&env, seed as u8, &student));
            }
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();
            assert_eq!(results.len(), MAX_BATCH_SIZE);
            assert_eq!(
                AcrediaCredential::total_credentials(env.clone()),
                MAX_BATCH_SIZE as u64
            );
        });
    }

    #[test]
    fn test_batch_issue_empty_rejected() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            let items: Vec<BatchCredentialInput> = Vec::new(&env);
            let result = AcrediaCredential::batch_issue_credential(env.clone(), issuer, items);
            assert_eq!(result, Err(ContractError::EmptyBatch));
        });
    }

    #[test]
    fn test_batch_issue_pause_blocks() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
            let items = soroban_sdk::vec![&env, dummy_batch_input(&env, 70, &student)];
            let result = AcrediaCredential::batch_issue_credential(env.clone(), issuer, items);
            assert_eq!(result, Err(ContractError::ContractPaused));
        });
    }

    #[test]
    fn test_batch_issue_unauthorized_issuer_rejected() {
        let (env, contract, _, _, student) = setup();
        let rogue = Address::generate(&env);
        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![&env, dummy_batch_input(&env, 71, &student)];
            let result = AcrediaCredential::batch_issue_credential(env.clone(), rogue, items);
            assert_eq!(result, Err(ContractError::IssuerNotAuthorized));
        });
    }

    #[test]
    fn test_batch_issue_requires_issuer_auth() {
        let (env, contract, _, issuer, student) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let items = soroban_sdk::vec![&env, dummy_batch_input(&env, 72, &student)];

        env.set_auths(&[]);
        assert!(client.try_batch_issue_credential(&issuer, &items).is_err());

        env.mock_all_auths();
        assert_eq!(client.total_credentials(), 0);
    }

    #[test]
    fn test_batch_issue_token_ids_interleave_with_single_issue() {
        let (env, contract, _, issuer, student) = setup();

        // Each call below is its own env.as_contract frame — matching the
        // setup() comment's rule that mock_all_auths() errors on a second
        // require_auth() for the same address within one synthetic frame.
        let id1 = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer.clone(),
                dummy_hash(&env, 80),
                String::from_str(&env, "ipfs://1"),
            )
            .unwrap()
        });
        assert_eq!(id1, 1);

        let results = env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                dummy_batch_input(&env, 81, &student),
                dummy_batch_input(&env, 82, &student),
            ];
            AcrediaCredential::batch_issue_credential(env.clone(), issuer.clone(), items).unwrap()
        });
        assert_eq!(results.get(0).unwrap().token_id, 2);
        assert_eq!(results.get(1).unwrap().token_id, 3);

        let id4 = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 83),
                String::from_str(&env, "ipfs://4"),
            )
            .unwrap()
        });
        assert_eq!(id4, 4);
    }

    #[test]
    fn test_batch_issue_emits_batch_summary_event() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let items = soroban_sdk::vec![
                &env,
                dummy_batch_input(&env, 90, &student),
                dummy_batch_input(&env, 91, &student),
            ];
            AcrediaCredential::batch_issue_credential(env.clone(), issuer.clone(), items).unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                symbol_short!("batch_is").into_val(&env),
                issuer.into_val(&env),
            ]
        );
    }

    // Revocation

    #[test]
    fn test_revoke_credential() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 4);
        let token_id = env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                hash,
                String::from_str(&env, "ipfs://b"),
            )
            .unwrap();

            assert!(!AcrediaCredential::is_revoked(env.clone(), token_id));
            token_id
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_credential(env.clone(), token_id, issuer).unwrap();
            assert!(AcrediaCredential::is_revoked(env.clone(), token_id));
        });
    }

    #[test]
    fn test_double_revoke_rejected() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                dummy_hash(&env, 5),
                String::from_str(&env, "ipfs://c"),
            )
            .unwrap();
            token_id
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_credential(env.clone(), token_id, issuer.clone()).unwrap();
        });

        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::revoke_credential(env.clone(), token_id, issuer),
                Err(ContractError::AlreadyRevoked)
            );
        });
    }

    #[test]
    fn test_unauthorized_revoker_rejected() {
        let (env, contract, _, issuer, student) = setup();
        let rogue = Address::generate(&env);
        let token_id = env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 6),
                String::from_str(&env, "ipfs://d"),
            )
            .unwrap();
            token_id
        });

        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::revoke_credential(env.clone(), token_id, rogue),
                Err(ContractError::UnauthorizedRevoker)
            );
        });
    }

    #[test]
    fn test_admin_revoke_credential() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 20),
                String::from_str(&env, "ipfs://admin-revoke"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::admin_revoke_credential(env.clone(), token_id).unwrap();
            assert!(AcrediaCredential::is_revoked(env.clone(), token_id));
        });
    }

    #[test]
    fn test_admin_revoke_works_after_issuer_deauthorized() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                dummy_hash(&env, 21),
                String::from_str(&env, "ipfs://compromised"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_issuer(env.clone(), issuer);
        });

        env.as_contract(&contract, || {
            AcrediaCredential::admin_revoke_credential(env.clone(), token_id).unwrap();
            assert!(AcrediaCredential::is_revoked(env.clone(), token_id));
        });
    }

    #[test]
    fn test_admin_revoke_requires_owner_auth() {
        let (env, contract, _, issuer, student) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 22),
                String::from_str(&env, "ipfs://auth"),
            )
            .unwrap()
        });

        env.set_auths(&[]);
        assert!(client.try_admin_revoke_credential(&token_id).is_err());

        env.mock_all_auths();
        assert!(!client.is_revoked(&token_id));
    }

    #[test]
    fn test_admin_revoke_nonexistent_rejected() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::admin_revoke_credential(env.clone(), 999),
                Err(ContractError::CredentialNotFound)
            );
        });
    }

    #[test]
    fn test_admin_revoke_already_revoked_rejected() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                dummy_hash(&env, 23),
                String::from_str(&env, "ipfs://twice"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_credential(env.clone(), token_id, issuer).unwrap();
        });

        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::admin_revoke_credential(env.clone(), token_id),
                Err(ContractError::AlreadyRevoked)
            );
        });
    }

    #[test]
    fn test_admin_revoke_emits_distinct_event() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 24),
                String::from_str(&env, "ipfs://evt"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::admin_revoke_credential(env.clone(), token_id).unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                Symbol::new(&env, "cred_rev_owner").into_val(&env),
                token_id.into_val(&env),
            ]
        );
    }

    #[test]
    fn property_only_issuer_can_revoke_seeded_credentials() {
        for seed in 0u8..12 {
            let (env, contract, _, issuer, student) = setup();
            let rogue = Address::generate(&env);
            let token_id = env.as_contract(&contract, || {
                AcrediaCredential::issue_credential(
                    env.clone(),
                    student.clone(),
                    issuer.clone(),
                    dummy_hash(&env, seed.wrapping_add(48)),
                    String::from_str(&env, "ipfs://issuer-only-property"),
                )
                .unwrap()
            });

            env.as_contract(&contract, || {
                assert_eq!(
                    AcrediaCredential::revoke_credential(env.clone(), token_id, rogue.clone()),
                    Err(ContractError::UnauthorizedRevoker)
                );

                AcrediaCredential::revoke_credential(env.clone(), token_id, issuer.clone())
                    .unwrap();
                assert!(AcrediaCredential::is_revoked(env.clone(), token_id));
            });
        }
    }

    #[test]
    fn test_get_credential_not_found() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::get_credential(env.clone(), 999),
                Err(ContractError::CredentialNotFound)
            );
        });
    }

    // Events

    #[test]
    fn test_credential_issued_event() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 7);
        let ipfs = String::from_str(&env, "ipfs://e");

        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(env.clone(), student, issuer, hash, ipfs).unwrap()
        });

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                symbol_short!("cred_iss").into_val(&env),
                token_id.into_val(&env),
            ]
        );
    }

    #[test]
    fn test_credential_revoked_event() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                dummy_hash(&env, 8),
                String::from_str(&env, "ipfs://f"),
            )
            .unwrap();
            token_id
        });
        env.as_contract(&contract, || {
            AcrediaCredential::revoke_credential(env.clone(), token_id, issuer).unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                symbol_short!("cred_rev").into_val(&env),
                token_id.into_val(&env),
            ]
        );
    }

    #[test]
    fn test_issuer_authorized_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        let issuer = Address::generate(&env);
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner).unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::authorize_issuer(env.clone(), issuer);
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("iss_auth").into_val(&env)]
        );
    }

    #[test]
    fn test_issuer_revoked_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        let issuer = Address::generate(&env);
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner).unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::authorize_issuer(env.clone(), issuer.clone());
        });
        env.as_contract(&contract, || {
            AcrediaCredential::revoke_issuer(env.clone(), issuer);
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("iss_rev").into_val(&env)]
        );
    }

    #[test]
    fn test_revoke_never_authorized_issuer_emits_no_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner).unwrap();
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_issuer(env.clone(), stranger);
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("init").into_val(&env)]
        );
    }

    #[test]
    fn test_revoke_authorized_issuer_emits_event_and_deauthorizes() {
        let (env, contract, _, issuer, _) = setup();

        assert!(env.as_contract(&contract, || {
            AcrediaCredential::is_authorized_issuer(env.clone(), issuer.clone())
        }));

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_issuer(env.clone(), issuer.clone());
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("iss_rev").into_val(&env)]
        );
        assert!(!env.as_contract(&contract, || {
            AcrediaCredential::is_authorized_issuer(env.clone(), issuer)
        }));
    }

    // Issuer profile

    /// Builds a length-`len` ASCII string without needing `alloc`/`std` —
    /// unlike proptest_invariants below, this module isn't linked against
    /// them, so no `.repeat()`/`format!`. The buffer is sized to one byte
    /// past the largest cap it is used to test, so raising a cap doesn't
    /// silently overflow the `[..len]` slice.
    fn dummy_long_str(env: &Env, len: usize) -> String {
        const BUF_LEN: usize = MAX_IPFS_URI_LEN as usize + 1;
        const BUF: [u8; BUF_LEN] = [b'a'; BUF_LEN];
        String::from_str(env, core::str::from_utf8(&BUF[..len]).unwrap())
    }

    #[test]
    fn test_set_and_get_issuer_profile() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            let name = String::from_str(&env, "Acredia University");
            let uri = String::from_str(&env, "ipfs://bafy-profile");
            AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer.clone(),
                name.clone(),
                uri.clone(),
            )
            .unwrap();

            let profile = AcrediaCredential::get_issuer_profile(env.clone(), issuer).unwrap();
            assert_eq!(profile.name, name);
            assert_eq!(profile.profile_uri, uri);
            assert_eq!(profile.updated_at, env.ledger().timestamp());
        });
    }

    #[test]
    fn test_get_issuer_profile_none_when_unset() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            assert!(AcrediaCredential::get_issuer_profile(env.clone(), issuer).is_none());
        });
    }

    #[test]
    fn test_set_issuer_profile_emits_event() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer.clone(),
                String::from_str(&env, "Acredia University"),
                String::from_str(&env, "ipfs://bafy-profile"),
            )
            .unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                symbol_short!("iss_prof").into_val(&env),
                issuer.into_val(&env),
            ]
        );
    }

    #[test]
    fn test_set_issuer_profile_update_overwrites_previous() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer.clone(),
                String::from_str(&env, "Old Name"),
                String::from_str(&env, "ipfs://old"),
            )
            .unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer.clone(),
                String::from_str(&env, "New Name"),
                String::from_str(&env, "ipfs://new"),
            )
            .unwrap();
        });

        env.as_contract(&contract, || {
            let profile = AcrediaCredential::get_issuer_profile(env.clone(), issuer).unwrap();
            assert_eq!(profile.name, String::from_str(&env, "New Name"));
            assert_eq!(profile.profile_uri, String::from_str(&env, "ipfs://new"));
        });
    }

    #[test]
    fn test_set_issuer_profile_requires_authorized_issuer() {
        let (env, contract, _, _, _) = setup();
        let rogue = Address::generate(&env);
        env.as_contract(&contract, || {
            let result = AcrediaCredential::set_issuer_profile(
                env.clone(),
                rogue,
                String::from_str(&env, "Fake U"),
                String::from_str(&env, ""),
            );
            assert_eq!(result, Err(ContractError::IssuerNotAuthorized));
        });
    }

    #[test]
    fn test_set_issuer_profile_rejects_oversized_name() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            let long_name = dummy_long_str(&env, (MAX_ISSUER_NAME_LEN + 1) as usize);
            let result = AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer,
                long_name,
                String::from_str(&env, ""),
            );
            assert_eq!(result, Err(ContractError::ProfileTooLarge));
        });
    }

    #[test]
    fn test_set_issuer_profile_rejects_oversized_uri() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            let long_uri = dummy_long_str(&env, (MAX_ISSUER_PROFILE_URI_LEN + 1) as usize);
            let result = AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer,
                String::from_str(&env, "Fine"),
                long_uri,
            );
            assert_eq!(result, Err(ContractError::ProfileTooLarge));
        });
    }

    #[test]
    fn test_set_issuer_profile_requires_issuer_auth() {
        let (env, contract, _, issuer, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let name = String::from_str(&env, "Acredia University");
        let uri = String::from_str(&env, "ipfs://bafy-profile");

        env.set_auths(&[]);
        assert!(client.try_set_issuer_profile(&issuer, &name, &uri).is_err());

        env.mock_all_auths();
        assert!(client.get_issuer_profile(&issuer).is_none());
    }

    #[test]
    fn test_issuer_profile_survives_revocation_but_blocks_further_updates() {
        let (env, contract, _, issuer, _) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer.clone(),
                String::from_str(&env, "Acredia University"),
                String::from_str(&env, "ipfs://bafy-profile"),
            )
            .unwrap();
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_issuer(env.clone(), issuer.clone());
        });

        env.as_contract(&contract, || {
            // Past identity binding is still resolvable after revocation...
            let profile =
                AcrediaCredential::get_issuer_profile(env.clone(), issuer.clone()).unwrap();
            assert_eq!(profile.name, String::from_str(&env, "Acredia University"));

            // ...but the now-unauthorized issuer can no longer update it.
            let result = AcrediaCredential::set_issuer_profile(
                env.clone(),
                issuer,
                String::from_str(&env, "New Name"),
                String::from_str(&env, "ipfs://new"),
            );
            assert_eq!(result, Err(ContractError::IssuerNotAuthorized));
        });
    }

    // ipfs_uri length cap (audit F-7)

    #[test]
    fn test_issue_credential_at_max_uri_len_succeeds() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let uri = dummy_long_str(&env, MAX_IPFS_URI_LEN as usize);
            let token_id = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 1),
                uri.clone(),
            )
            .unwrap();

            // Exactly-at-the-cap is accepted and stored verbatim.
            let credential = AcrediaCredential::get_credential(env.clone(), token_id).unwrap();
            assert_eq!(credential.ipfs_hash, uri);
            assert_eq!(credential.ipfs_hash.len(), MAX_IPFS_URI_LEN);
        });
    }

    #[test]
    fn test_issue_credential_rejects_oversized_uri() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let uri = dummy_long_str(&env, (MAX_IPFS_URI_LEN + 1) as usize);
            let result = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 1),
                uri,
            );
            assert_eq!(result, Err(ContractError::UriTooLarge));

            // A typed error, not a panic — and nothing was written: the
            // rejected credential's hash must stay free for a later, valid
            // re-issue, and the counter must not move.
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 0);
            assert_eq!(
                AcrediaCredential::get_credential(env.clone(), 1),
                Err(ContractError::CredentialNotFound)
            );
            assert!(
                AcrediaCredential::verify_credential(env.clone(), dummy_hash(&env, 1)).is_none()
            );
        });
    }

    #[test]
    fn test_batch_issue_at_max_uri_len_succeeds() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let uri = dummy_long_str(&env, MAX_IPFS_URI_LEN as usize);
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: dummy_hash(&env, 1),
                    ipfs_uri: uri.clone(),
                }
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();

            assert_eq!(results.len(), 1);
            let row = results.get(0).unwrap();
            assert!(row.success);
            assert_eq!(row.error_code, 0);

            let credential = AcrediaCredential::get_credential(env.clone(), row.token_id).unwrap();
            assert_eq!(credential.ipfs_hash, uri);
        });
    }

    #[test]
    fn test_batch_issue_rejects_oversized_uri_per_row() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            let oversized = dummy_long_str(&env, (MAX_IPFS_URI_LEN + 1) as usize);
            // Row 0 is oversized; rows 1 and 2 are fine. The bad row must be
            // reported as a failure without discarding its neighbours.
            let items = soroban_sdk::vec![
                &env,
                BatchCredentialInput {
                    student: student.clone(),
                    credential_hash: dummy_hash(&env, 1),
                    ipfs_uri: oversized,
                },
                dummy_batch_input(&env, 2, &student),
                dummy_batch_input(&env, 3, &student),
            ];
            let results =
                AcrediaCredential::batch_issue_credential(env.clone(), issuer, items).unwrap();

            assert_eq!(results.len(), 3);

            let bad = results.get(0).unwrap();
            assert!(!bad.success);
            assert_eq!(bad.token_id, 0);
            assert_eq!(bad.error_code, ContractError::UriTooLarge as u32);

            for i in 1..3u32 {
                let row = results.get(i).unwrap();
                assert!(row.success);
                assert_eq!(row.error_code, 0);
            }

            // Only the two good rows were persisted, and token ids stayed
            // sequential — the rejected row consumed no id.
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 2);
            assert_eq!(results.get(1).unwrap().token_id, 1);
            assert_eq!(results.get(2).unwrap().token_id, 2);

            // The rejected row reserved nothing: its hash is still free.
            assert!(
                AcrediaCredential::verify_credential(env.clone(), dummy_hash(&env, 1)).is_none()
            );
        });
    }

    // Totals

    #[test]
    fn test_total_credentials() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 0);

            AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer.clone(),
                dummy_hash(&env, 9),
                String::from_str(&env, "ipfs://g"),
            )
            .unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 10),
                String::from_str(&env, "ipfs://h"),
            )
            .unwrap();

            assert_eq!(AcrediaCredential::total_credentials(env.clone()), 2);
        });
    }

    // ---------------------------------------------------------------------------
    // TTL / archival tests
    // ---------------------------------------------------------------------------

    /// Issue a credential, advance the ledger sequence past the default
    /// min_persistent_entry_ttl (4 096 ledgers), and assert the entry is still
    /// retrievable.  This would fail if extend_ttl were not called, because the
    /// Soroban test environment enforces TTL expiry when the sequence advances.
    #[test]
    fn test_credential_survives_large_ledger_advance() {
        use soroban_sdk::testutils::Ledger;

        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 20);
        let ipfs = String::from_str(&env, "ipfs://ttl-test");

        // Issue the credential at ledger sequence 0.
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student.clone(),
                issuer.clone(),
                hash.clone(),
                ipfs,
            )
            .unwrap()
        });

        // Advance well past min_persistent_entry_ttl (4 096) but within
        // PERSISTENT_BUMP_AMOUNT (6_312_000).  We use a value that is larger
        // than the minimum TTL yet smaller than the bump, proving the entry was
        // extended beyond the minimum.
        env.ledger().set_sequence_number(5_000_000);

        // The credential must still be readable after the advance.
        env.as_contract(&contract, || {
            let cred = AcrediaCredential::verify_credential(env.clone(), hash.clone())
                .expect("credential must survive large ledger advance");
            assert_eq!(cred.token_id, token_id);
            assert_eq!(cred.student, student);
            assert!(!cred.revoked);

            // get_credential should also work.
            let cred2 = AcrediaCredential::get_credential(env.clone(), token_id)
                .expect("get_credential must survive large ledger advance");
            assert_eq!(cred2.token_id, token_id);
        });
    }

    #[test]
    fn property_credentials_survive_large_ledger_advances() {
        use soroban_sdk::testutils::Ledger;

        for seed in 0u8..8 {
            let (env, contract, _, issuer, student) = setup();
            let hash = dummy_hash(&env, seed.wrapping_add(80));
            let ipfs = String::from_str(&env, "ipfs://ttl-property");

            let token_id = env.as_contract(&contract, || {
                AcrediaCredential::issue_credential(
                    env.clone(),
                    student.clone(),
                    issuer.clone(),
                    hash.clone(),
                    ipfs,
                )
                .unwrap()
            });

            if seed % 2 == 1 {
                env.as_contract(&contract, || {
                    AcrediaCredential::revoke_credential(env.clone(), token_id, issuer.clone())
                        .unwrap();
                });
            }

            env.ledger()
                .set_sequence_number(5_000_000 + u32::from(seed) * 10_000);

            env.as_contract(&contract, || {
                let credential = AcrediaCredential::get_credential(env.clone(), token_id)
                    .expect("credential must survive large ledger advance");
                assert_eq!(credential.token_id, token_id);
                assert_eq!(credential.student, student);
                assert_eq!(credential.revoked, seed % 2 == 1);

                let verified = AcrediaCredential::verify_credential(env.clone(), hash.clone())
                    .expect("credential hash must remain indexed across TTL extensions");
                assert_eq!(verified.token_id, token_id);
            });
        }
    }

    /// Verify that a *revoked* credential is still retrievable after a large
    /// ledger advance so verifiers can distinguish "revoked" from "missing".
    #[test]
    fn test_revoked_credential_survives_large_ledger_advance() {
        use soroban_sdk::testutils::Ledger;

        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 21);

        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                hash.clone(),
                String::from_str(&env, "ipfs://revoke-ttl"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::revoke_credential(env.clone(), token_id, issuer).unwrap();
        });

        env.ledger().set_sequence_number(5_000_000);

        env.as_contract(&contract, || {
            let cred = AcrediaCredential::get_credential(env.clone(), token_id)
                .expect("revoked credential must survive large ledger advance");
            assert!(cred.revoked, "credential should be marked revoked");
        });
    }

    /// bump_credential must succeed and keep the entry alive past a large
    /// simulated ledger advance even when called by an unprivileged party.
    #[test]
    fn test_bump_credential_extends_ttl() {
        use soroban_sdk::testutils::Ledger;

        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 22);

        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                hash.clone(),
                String::from_str(&env, "ipfs://bump-ttl"),
            )
            .unwrap()
        });

        // Advance to just before the natural expiry without extending.
        env.ledger().set_sequence_number(4_000_000);

        // An unprivileged bump (no auth required) should extend the TTL.
        env.as_contract(&contract, || {
            AcrediaCredential::bump_credential(env.clone(), token_id)
                .expect("bump_credential must succeed");
        });

        // Advance again past the original issue TTL to confirm the bump worked.
        env.ledger().set_sequence_number(5_500_000);

        env.as_contract(&contract, || {
            AcrediaCredential::get_credential(env.clone(), token_id)
                .expect("credential must be readable after bump");
        });
    }

    /// bump_credential returns CredentialNotFound for unknown token ids.
    #[test]
    fn test_bump_credential_not_found() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            assert_eq!(
                AcrediaCredential::bump_credential(env.clone(), 9999),
                Err(ContractError::CredentialNotFound)
            );
        });
    }
    #[test]
    fn test_authorization_migration() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        let issuer = Address::generate(&env);
        let student = Address::generate(&env);

        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner.clone()).unwrap();

            // Manually simulate an old deployment by writing to instance storage directly
            env.storage()
                .instance()
                .set(&DataKey::Authorized(issuer.clone()), &true);

            // Confirm it's not in persistent storage
            assert!(!env
                .storage()
                .persistent()
                .has(&DataKey::Authorized(issuer.clone())));

            // Call is_authorized_issuer, which should trigger the migration
            let is_auth = AcrediaCredential::is_authorized_issuer(env.clone(), issuer.clone());
            assert!(
                is_auth,
                "Issuer should be authorized via migration fallback"
            );

            // Check that it's now in persistent storage and removed from instance
            assert!(env
                .storage()
                .persistent()
                .has(&DataKey::Authorized(issuer.clone())));
            assert!(!env
                .storage()
                .instance()
                .has(&DataKey::Authorized(issuer.clone())));
        });

        env.as_contract(&contract, || {
            let hash = dummy_hash(&env, 99);
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                hash,
                String::from_str(&env, "ipfs://test"),
            )
            .expect("Should issue credential using migrated authorization");
        });
    }

    #[test]
    fn test_upgrade_owner_gated() {
        use soroban_sdk::testutils::Ledger;
        let (env, contract, owner, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        let wasm_bytes = include_bytes!("../target/wasm32v1-none/release/acredia_stellar.wasm");
        let new_wasm_hash = env
            .deployer()
            .upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, wasm_bytes));

        client.propose_upgrade(&new_wasm_hash);
        let now = env.ledger().sequence();
        env.ledger()
            .set_sequence_number(now + UPGRADE_TIMELOCK_LEDGERS);
        client.upgrade(&new_wasm_hash);

        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        let (auth_addr, invocation) = &auths[0];
        assert_eq!(auth_addr, &owner);
        assert_eq!(
            invocation.function,
            soroban_sdk::testutils::AuthorizedFunction::Contract((
                contract.clone(),
                soroban_sdk::Symbol::new(&env, "upgrade"),
                (new_wasm_hash,).into_val(&env),
            ))
        );
    }

    #[test]
    fn test_propose_upgrade_emits_event() {
        let (env, contract, _, _, _) = setup();
        let hash = dummy_hash(&env, 94);
        env.as_contract(&contract, || {
            AcrediaCredential::propose_upgrade(env.clone(), hash).unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("upg_prop").into_val(&env)]
        );
    }

    #[test]
    fn test_propose_upgrade_records_pending() {
        let (env, contract, _, _, _) = setup();
        let hash = dummy_hash(&env, 95);
        let now = env.ledger().sequence();
        env.as_contract(&contract, || {
            AcrediaCredential::propose_upgrade(env.clone(), hash.clone()).unwrap();
            let pending = AcrediaCredential::get_pending_upgrade(env.clone()).unwrap();
            assert_eq!(pending.wasm_hash, hash);
            assert_eq!(pending.ready_ledger, now + UPGRADE_TIMELOCK_LEDGERS);
        });
    }

    #[test]
    fn test_upgrade_without_proposal_rejected() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            let result = AcrediaCredential::upgrade(env.clone(), dummy_hash(&env, 93));
            assert_eq!(result, Err(ContractError::UpgradeNotProposed));
        });
    }

    #[test]
    fn test_upgrade_before_timelock_rejected() {
        let (env, contract, _, _, _) = setup();
        let hash = dummy_hash(&env, 90);
        env.as_contract(&contract, || {
            AcrediaCredential::propose_upgrade(env.clone(), hash.clone()).unwrap();
        });
        env.as_contract(&contract, || {
            let result = AcrediaCredential::upgrade(env.clone(), hash);
            assert_eq!(result, Err(ContractError::UpgradeTimelockActive));
        });
    }

    #[test]
    fn test_upgrade_hash_mismatch_rejected() {
        use soroban_sdk::testutils::Ledger;
        let (env, contract, _, _, _) = setup();
        let proposed = dummy_hash(&env, 91);
        let other = dummy_hash(&env, 92);
        env.as_contract(&contract, || {
            AcrediaCredential::propose_upgrade(env.clone(), proposed).unwrap();
        });
        let now = env.ledger().sequence();
        env.ledger()
            .set_sequence_number(now + UPGRADE_TIMELOCK_LEDGERS);
        env.as_contract(&contract, || {
            let result = AcrediaCredential::upgrade(env.clone(), other);
            assert_eq!(result, Err(ContractError::UpgradeHashMismatch));
        });
    }

    #[test]
    fn test_cancel_upgrade_clears_pending() {
        let (env, contract, _, _, _) = setup();
        let hash = dummy_hash(&env, 96);
        env.as_contract(&contract, || {
            AcrediaCredential::propose_upgrade(env.clone(), hash.clone()).unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::cancel_upgrade(env.clone()).unwrap();
            assert!(AcrediaCredential::get_pending_upgrade(env.clone()).is_none());
        });
        env.as_contract(&contract, || {
            let result = AcrediaCredential::upgrade(env.clone(), hash);
            assert_eq!(result, Err(ContractError::UpgradeNotProposed));
        });
    }

    #[test]
    fn test_cancel_upgrade_without_proposal_rejected() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            let result = AcrediaCredential::cancel_upgrade(env.clone());
            assert_eq!(result, Err(ContractError::UpgradeNotProposed));
        });
    }

    #[test]
    fn test_get_storage_version_and_migrate() {
        let (env, contract, owner, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        assert_eq!(client.get_storage_version(), 1);

        client.migrate();
        let auths = env.auths();

        assert_eq!(client.get_storage_version(), 2);

        assert_eq!(auths.len(), 1);
        let (auth_addr, invocation) = &auths[0];
        assert_eq!(auth_addr, &owner);
        assert_eq!(
            invocation.function,
            soroban_sdk::testutils::AuthorizedFunction::Contract((
                contract.clone(),
                soroban_sdk::Symbol::new(&env, "migrate"),
                ().into_val(&env),
            ))
        );
    }

    #[test]
    fn test_migrate_only_once() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        assert_eq!(client.get_storage_version(), 1);
        client.migrate();
        assert_eq!(client.get_storage_version(), 2);

        client.migrate();
        assert_eq!(client.get_storage_version(), 2);
    }

    // ---------------------------------------------------------------------------
    // Pause / circuit-breaker tests
    // ---------------------------------------------------------------------------

    #[test]
    fn test_pause_blocks_issue() {
        let (env, contract, _, issuer, student) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
            assert!(AcrediaCredential::is_paused(env.clone()));

            let result = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 30),
                String::from_str(&env, "ipfs://paused"),
            );
            assert_eq!(result, Err(ContractError::ContractPaused));
        });
    }

    #[test]
    fn test_pause_blocks_revoke() {
        let (env, contract, _, issuer, student) = setup();
        let token_id = env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer.clone(),
                dummy_hash(&env, 31),
                String::from_str(&env, "ipfs://before-pause"),
            )
            .unwrap()
        });

        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
            let result = AcrediaCredential::revoke_credential(env.clone(), token_id, issuer);
            assert_eq!(result, Err(ContractError::ContractPaused));
        });
    }

    #[test]
    fn test_verify_works_while_paused() {
        let (env, contract, _, issuer, student) = setup();
        let hash = dummy_hash(&env, 32);
        env.as_contract(&contract, || {
            AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                hash.clone(),
                String::from_str(&env, "ipfs://paused-verify"),
            )
            .unwrap();
            AcrediaCredential::pause(env.clone()).unwrap();
            // verify_credential and get_credential must still work
            let cred = AcrediaCredential::verify_credential(env.clone(), hash.clone());
            assert!(cred.is_some());
            let cred2 = AcrediaCredential::get_credential(env.clone(), cred.unwrap().token_id);
            assert!(cred2.is_ok());
        });
    }

    #[test]
    fn test_unpause_restores_issuance() {
        let (env, contract, _, issuer, student) = setup();
        // pause and unpause must be separate frames; same-frame double owner.require_auth errors
        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
        });
        env.as_contract(&contract, || {
            assert!(AcrediaCredential::is_paused(env.clone()));
            AcrediaCredential::unpause(env.clone()).unwrap();
            assert!(!AcrediaCredential::is_paused(env.clone()));
            // issue uses issuer auth (different address), so no conflict
            let result = AcrediaCredential::issue_credential(
                env.clone(),
                student,
                issuer,
                dummy_hash(&env, 33),
                String::from_str(&env, "ipfs://after-unpause"),
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_pause_event() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
        });
        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("paused").into_val(&env)]
        );
    }

    #[test]
    fn test_unpause_event() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            AcrediaCredential::pause(env.clone()).unwrap();
        });
        env.as_contract(&contract, || {
            AcrediaCredential::unpause(env.clone()).unwrap();
        });
        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("unpaused").into_val(&env)]
        );
    }

    #[test]
    fn test_is_paused_default_false() {
        let (env, contract, _, _, _) = setup();
        env.as_contract(&contract, || {
            assert!(!AcrediaCredential::is_paused(env.clone()));
        });
    }

    // ---------------------------------------------------------------------------
    // Event coverage: initialize / upgrade / migrate
    // ---------------------------------------------------------------------------

    #[test]
    fn test_initialize_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = AcrediaCredential.register(&env, None, ());
        let owner = Address::generate(&env);
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner).unwrap();
        });

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("init").into_val(&env)]
        );
    }

    #[test]
    fn test_upgrade_event() {
        use soroban_sdk::testutils::Ledger;
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let wasm_bytes = include_bytes!("../target/wasm32v1-none/release/acredia_stellar.wasm");
        let new_wasm_hash = env
            .deployer()
            .upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, wasm_bytes));

        client.propose_upgrade(&new_wasm_hash);
        let now = env.ledger().sequence();
        env.ledger()
            .set_sequence_number(now + UPGRADE_TIMELOCK_LEDGERS);
        client.upgrade(&new_wasm_hash);

        assert_eq!(
            last_event_topics(&env),
            vec![&env, symbol_short!("upgraded").into_val(&env)]
        );
    }

    #[test]
    fn test_migrate_event() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        client.migrate();

        assert_eq!(
            last_event_topics(&env),
            vec![
                &env,
                symbol_short!("migrated").into_val(&env),
                1u32.into_val(&env),
            ]
        );
    }

    // ---------------------------------------------------------------------------
    // Owner-only entrypoint gating
    //
    // `setup()` uses mock_all_auths(), which mocks every require_auth() as
    // succeeding regardless of who is "calling" — so it cannot, by itself,
    // prove a privileged entrypoint is actually gated. Each test below
    // disables mocking via `env.set_auths(&[])` immediately before invoking
    // the privileged call, so the underlying owner.require_auth() /
    // pending_owner.require_auth() must be satisfied for real. With no
    // authorization supplied, the call must fail, and contract state must be
    // left unchanged.
    // ---------------------------------------------------------------------------

    #[test]
    fn test_initialize_requires_owner_auth() {
        let env = Env::default();
        let contract = AcrediaCredential.register(&env, None, ());
        let client = AcrediaCredentialClient::new(&env, &contract);
        let owner = Address::generate(&env);

        // No auths mocked: initialize must fail without the proposed owner's signature.
        assert!(client.try_initialize(&owner).is_err());
        // And the contract must remain uninitialized.
        assert!(client.try_get_owner().is_err());
    }

    #[test]
    fn test_transfer_owner_requires_owner_auth() {
        let (env, contract, owner, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let new_owner = Address::generate(&env);

        env.set_auths(&[]);
        assert!(client.try_transfer_owner(&new_owner).is_err());

        env.mock_all_auths();
        assert_eq!(client.get_owner(), owner);
        assert!(client.get_pending_owner().is_none());
    }

    #[test]
    fn test_accept_owner_requires_pending_owner_auth() {
        let (env, contract, owner, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let new_owner = Address::generate(&env);
        client.transfer_owner(&new_owner);

        env.set_auths(&[]);
        assert!(client.try_accept_owner().is_err());

        env.mock_all_auths();
        assert_eq!(client.get_owner(), owner);
    }

    #[test]
    fn test_authorize_issuer_requires_owner_auth() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let rogue_issuer = Address::generate(&env);

        env.set_auths(&[]);
        assert!(client.try_authorize_issuer(&rogue_issuer).is_err());

        env.mock_all_auths();
        assert!(!client.is_authorized_issuer(&rogue_issuer));
    }

    #[test]
    fn test_revoke_issuer_requires_owner_auth() {
        let (env, contract, _, issuer, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        env.set_auths(&[]);
        assert!(client.try_revoke_issuer(&issuer).is_err());

        env.mock_all_auths();
        assert!(client.is_authorized_issuer(&issuer));
    }

    #[test]
    fn test_pause_requires_owner_auth() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        env.set_auths(&[]);
        assert!(client.try_pause().is_err());

        env.mock_all_auths();
        assert!(!client.is_paused());
    }

    #[test]
    fn test_unpause_requires_owner_auth() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        client.pause();

        env.set_auths(&[]);
        assert!(client.try_unpause().is_err());

        env.mock_all_auths();
        assert!(client.is_paused());
    }

    #[test]
    fn test_upgrade_requires_owner_auth() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);
        let wasm_bytes = include_bytes!("../target/wasm32v1-none/release/acredia_stellar.wasm");
        let new_wasm_hash = env
            .deployer()
            .upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, wasm_bytes));

        env.set_auths(&[]);
        assert!(client.try_upgrade(&new_wasm_hash).is_err());
    }

    #[test]
    fn test_migrate_requires_owner_auth() {
        let (env, contract, _, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        env.set_auths(&[]);
        assert!(client.try_migrate().is_err());

        env.mock_all_auths();
        assert_eq!(client.get_storage_version(), 1);
    }
}

// ---------------------------------------------------------------------------
// Property / invariant tests for issuance & revocation.
//
// Rather than a handful of fixed scenarios, this generates randomized
// sequences of issue/revoke operations (proptest shrinks any failing case to
// a minimal reproduction) and checks that core invariants hold after every
// step and at the end of the run:
//   - token ids are assigned sequentially starting at 1
//   - a hash can back at most one credential, ever
//   - only the recorded issuer of a credential can revoke it
//   - revocation is monotonic (never un-revoked) and idempotent-safe
//     (a second revoke always fails with AlreadyRevoked)
//   - total_credentials always equals the number of successful issuances
//   - every issued credential remains retrievable by id and by hash, with
//     state matching the model built alongside the contract calls
// ---------------------------------------------------------------------------
#[cfg(test)]
mod proptest_invariants {
    extern crate std;

    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::{Address as _, Register};

    fn seed_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    #[derive(Debug, Clone)]
    enum Op {
        Issue {
            issuer_idx: u8,
            student_idx: u8,
            hash_seed: u8,
        },
        Revoke {
            by_idx: u8,
            token_pick: u8,
        },
    }

    fn op_strategy() -> impl Strategy<Value = Op> {
        prop_oneof![
            (0u8..3, 0u8..3, 0u8..5).prop_map(|(issuer_idx, student_idx, hash_seed)| {
                Op::Issue {
                    issuer_idx,
                    student_idx,
                    hash_seed,
                }
            }),
            (0u8..4, 0u8..8).prop_map(|(by_idx, token_pick)| Op::Revoke { by_idx, token_pick }),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]

        #[test]
        fn invariant_issuance_and_revocation_hold(ops in prop::collection::vec(op_strategy(), 1..25)) {
            // Skip the on-drop test-snapshot JSON dump: with randomized
            // cases there is no single meaningful scenario worth freezing to
            // disk the way the named scenario tests in `mod tests` are.
            let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
                capture_snapshot_at_drop: false,
            });
            env.mock_all_auths();
            let contract = AcrediaCredential.register(&env, None, ());
            let owner = Address::generate(&env);
            let issuers: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();
            // A 4th, never-authorized address used by `Revoke { by_idx: 3, .. }`
            // to exercise the "not the recorded issuer" rejection path.
            let rogue = Address::generate(&env);
            let students: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();

            env.as_contract(&contract, || {
                AcrediaCredential::initialize(env.clone(), owner.clone()).unwrap();
            });
            for issuer in issuers.iter() {
                env.as_contract(&contract, || {
                    AcrediaCredential::authorize_issuer(env.clone(), issuer.clone());
                });
            }

            // Parallel model: token_id -> (hash, issuer, revoked).
            let mut issued: std::vec::Vec<(u64, BytesN<32>, Address, bool)> = std::vec::Vec::new();
            let mut used_seeds: std::collections::HashSet<u8> = std::collections::HashSet::new();
            let mut success_count: u64 = 0;

            for op in ops {
                match op {
                    Op::Issue { issuer_idx, student_idx, hash_seed } => {
                        let issuer = issuers[issuer_idx as usize % issuers.len()].clone();
                        let student = students[student_idx as usize % students.len()].clone();
                        let hash = seed_hash(&env, hash_seed);
                        let ipfs = String::from_str(&env, "ipfs://proptest");
                        let hash_reused = used_seeds.contains(&hash_seed);

                        let result = env.as_contract(&contract, || {
                            AcrediaCredential::issue_credential(
                                env.clone(),
                                student,
                                issuer.clone(),
                                hash.clone(),
                                ipfs,
                            )
                        });

                        if hash_reused {
                            prop_assert_eq!(result, Err(ContractError::CredentialAlreadyExists));
                        } else {
                            let token_id = result.expect("fresh hash must issue successfully");
                            prop_assert_eq!(
                                token_id,
                                success_count + 1,
                                "token ids must be assigned sequentially starting at 1"
                            );
                            issued.push((token_id, hash, issuer, false));
                            used_seeds.insert(hash_seed);
                            success_count += 1;
                        }
                    }
                    Op::Revoke { by_idx, token_pick } => {
                        if issued.is_empty() {
                            continue;
                        }
                        let idx = token_pick as usize % issued.len();
                        let (token_id, _hash, true_issuer, already_revoked) = issued[idx].clone();
                        let caller = if (by_idx as usize) < issuers.len() {
                            issuers[by_idx as usize].clone()
                        } else {
                            rogue.clone()
                        };

                        let result = env.as_contract(&contract, || {
                            AcrediaCredential::revoke_credential(env.clone(), token_id, caller.clone())
                        });

                        // Mirrors revoke_credential's own precedence: issuer
                        // identity is checked before the revoked flag.
                        if caller != true_issuer {
                            prop_assert_eq!(result, Err(ContractError::UnauthorizedRevoker));
                        } else if already_revoked {
                            prop_assert_eq!(result, Err(ContractError::AlreadyRevoked));
                        } else {
                            prop_assert!(result.is_ok());
                            issued[idx].3 = true;
                        }

                        let is_rev = env.as_contract(&contract, || {
                            AcrediaCredential::is_revoked(env.clone(), token_id)
                        });
                        prop_assert_eq!(is_rev, issued[idx].3, "revocation must be monotonic");
                    }
                }
            }

            let total = env.as_contract(&contract, || AcrediaCredential::total_credentials(env.clone()));
            prop_assert_eq!(total, success_count, "total_credentials must equal successful issuances");

            for (token_id, hash, issuer, revoked) in issued.iter() {
                let cred = env
                    .as_contract(&contract, || AcrediaCredential::get_credential(env.clone(), *token_id))
                    .expect("every issued credential must remain retrievable by id");
                prop_assert_eq!(&cred.issuer, issuer);
                prop_assert_eq!(cred.revoked, *revoked);

                let verified = env
                    .as_contract(&contract, || {
                        AcrediaCredential::verify_credential(env.clone(), hash.clone())
                    })
                    .expect("every issued credential must remain retrievable by hash");
                prop_assert_eq!(verified.token_id, *token_id);
            }
        }
    }
}
