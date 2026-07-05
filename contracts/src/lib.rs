#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String,
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
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextTokenId, &1u64);
        extend_instance_ttl(&env);
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
        env.storage()
            .persistent()
            .remove(&DataKey::Authorized(issuer.clone()));
        env.storage()
            .instance()
            .remove(&DataKey::Authorized(issuer.clone()));
        extend_instance_ttl(&env);
        env.events().publish((symbol_short!("iss_rev"),), issuer);
    }

    pub fn is_authorized_issuer(env: Env, issuer: Address) -> bool {
        require_initialized(&env);
        extend_instance_ttl(&env);
        check_and_extend_authorization(&env, &issuer)
    }

    pub fn issue_credential(
        env: Env,
        student: Address,
        issuer: Address,
        credential_hash: BytesN<32>,
        ipfs_uri: String,
    ) -> Result<u64, ContractError> {
        issuer.require_auth();

        if !check_and_extend_authorization(&env, &issuer) {
            return Err(ContractError::IssuerNotAuthorized);
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

    pub fn revoke_credential(
        env: Env,
        token_id: u64,
        issuer: Address,
    ) -> Result<(), ContractError> {
        issuer.require_auth();

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

    /// Upgrade the contract to a new WebAssembly code using a WASM hash.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let owner = read_owner(&env);
        owner.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        extend_instance_ttl(&env);
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
        env.as_contract(&contract, || {
            AcrediaCredential::initialize(env.clone(), owner.clone()).unwrap();
            AcrediaCredential::authorize_issuer(env.clone(), issuer.clone());
        });
        (env, contract, owner, issuer, student)
    }

    fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
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
        let (env, contract, owner, _, _) = setup();
        let client = AcrediaCredentialClient::new(&env, &contract);

        let wasm_bytes = include_bytes!("../target/wasm32v1-none/release/acredia_stellar.wasm");
        let new_wasm_hash = env
            .deployer()
            .upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, wasm_bytes));

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
}
