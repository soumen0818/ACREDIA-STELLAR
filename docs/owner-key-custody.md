# Owner Key Custody Decision

**Issue**: [#279 — Contract owner key custody is undecided](https://github.com/soumen0818/ACREDIA-STELLAR/issues/279)
**Status**: Decided — multisig recommended, transfer procedure documented
**Last reviewed**: 2026-10-02

---

## 1. Decision

The `AcrediaCredential` contract owner key **must not** reside on any developer
workstation at mainnet launch. The selected custody mechanism is:

**Stellar account-level multisig** (N-of-M threshold, e.g. 2-of-3 signers).

No contract change is required. The existing `transfer_owner` / `accept_owner`
two-step handover (contracts/src/lib.rs lines 283–322) already provides a safe
handover path. Stellar account-level multisig operates at the account layer and
is transparent to the contract.

### Why multisig, not a hardware wallet alone?

| Option | Survives one person unavailable? | Survives key loss? |
|---|---|---|
| Single hardware wallet | ❌ No | ❌ No |
| HSM (single custodian) | ❌ No | ❌ No |
| Stellar multisig (2-of-3) | ✅ Yes | ✅ Yes (1 key lost) |

Multisig is the only option that tolerates a single holder being unavailable
or a single key being lost, which is the minimum acceptable posture for a
mainnet governance key.

---

## 2. Custody arrangement

### 2.1 Key holders

A minimum of **three** independent signers must be designated before mainnet
launch. Each signer:

- Holds their signing key on a hardware wallet (Ledger or equivalent), not on
  a networked machine.
- Is a named, identifiable team member or trustee — not a shared account.
- Has independently verified they can sign a Stellar transaction before the
  arrangement goes live.

Exact holder names are recorded in the team's internal security registry
(not in this public document).

### 2.2 Approval threshold

The multisig account requires **2-of-3 signatures** for any privileged
operation. This means:

- Authorizing a new issuer requires two holders to co-sign.
- Initiating an ownership transfer (`transfer_owner`) requires two co-signers.
- No single holder can act unilaterally.

### 2.3 What counts as an authorized use?

Authorizing an issuer is **not** a routine operation. Before any privileged
transaction is submitted:

1. A written request is filed (GitHub issue or equivalent internal tracker).
2. At least two key holders review and approve the request asynchronously.
3. The transaction is constructed and reviewed before signing — never signed
   blind.
4. The signed transaction hash and outcome are logged in the request thread.

---

## 3. Recovery procedure

### 3.1 One key compromised or lost

- The remaining two holders immediately initiate `transfer_owner` to a new
  multisig account that excludes the compromised key.
- The compromised key's Stellar account is merged or its weight set to zero
  on the multisig account.
- A replacement holder is identified and onboarded within 30 days.

### 3.2 Two keys compromised simultaneously

Two compromised keys can meet a 2-of-3 threshold. The one honest holder cannot
transfer ownership or pause alone; both calls authorize the same owner account,
and Stellar enforces its multisig threshold. Treat this as an active owner
compromise: stop privileged operator workflows, notify institutions and the
incident team, preserve chain evidence, and publish the incident timeline.
If the attackers have already changed the signer set, recovery may require a
new contract and publicly documented migration. Do not assume a unilateral
emergency pause is available. A paused contract also blocks revocation, so a
pause is not a harmless issuance-only switch.

### 3.3 Owner key entirely lost (all holders unavailable)

If the 2-of-3 threshold is permanently unachievable:

- No new issuers can ever be authorized on that contract instance.
- Existing credentials remain permanently verifiable on-chain (they are stored
  under persistent storage keys tied to the credential, not the owner).
- A new contract must be deployed and initialized with a new owner from the
  start. Existing institutions migrate by re-authorization on the new contract.
- This is the consequence of losing a governance key with no recovery path in
  the contract — the operational mitigation is maintaining the 2-of-3 threshold
  and rotating promptly when a key is lost (§3.1).

---

## 4. Ownership transfer at mainnet launch

The transfer procedure from a dev-machine key to the multisig account must be
**rehearsed on testnet** before mainnet launch. The steps are:

### Step 1 — Set up the multisig account

Fund a dedicated Stellar G-account on **testnet**. Record its public key and
three independently generated hardware-held signer public keys. Add the three
signers with weight 1, verify each on-ledger, and only then set low/medium/high
thresholds to 2 and the master-key weight to 0. Do not disable the master key
before two signers can successfully sign a test payment. Example for one signer:

```bash
stellar tx new set-options --source <MULTISIG_MASTER_IDENTITY> --network testnet \
  --signer <HOLDER_A_PUBLIC> --signer-weight 1
# Repeat for holders B and C, verify all three, then change thresholds/master weight.
```

Here `MULTISIG_MASTER_IDENTITY` is the temporary testnet account's signing
identity, not its public G-address; a public address cannot sign a submitted
set-options transaction. Retire this master key only after threshold operations
work. The exact CLI version and hardware derivation path must be recorded in the
internal rehearsal log. Verify the final signer weights and all three
thresholds from the account entry in Horizon, not only from CLI output.

### Step 2 — Initiate transfer with the current owner

```bash
stellar contract invoke --network testnet --source <CURRENT_OWNER_IDENTITY> \
  --id <CONTRACT_ID> -- transfer_owner --new_owner <MULTISIG_ACCOUNT>
```

Record the transaction hash and `own_xfer` event before proceeding.

### Step 3 — Build one acceptance envelope and collect two signatures

The **multisig account itself** is the transaction source and the contract
authorizer. Build, simulate, then have two different hardware holders review
and sign the **same** envelope. The first signature alone must not submit.
Run each signing step on the holder's own device; transfer only XDR between
holders, never keys. With Stellar CLI 27:

```bash
stellar contract invoke --network testnet --source <MULTISIG_ACCOUNT> \
  --id <CONTRACT_ID> --build-only -- accept_owner > unsigned.xdr
stellar tx simulate --network testnet --source-account <MULTISIG_ACCOUNT> \
  < unsigned.xdr > prepared.xdr
stellar tx sign --network testnet --sign-with-ledger \
  < prepared.xdr > holder-a.xdr
# Transfer holder-a.xdr to holder B's hardware-signing workstation.
stellar tx sign --network testnet --sign-with-ledger \
  < holder-a.xdr > both-holders.xdr
stellar tx send --network testnet < both-holders.xdr
```

Confirm two **distinct** signer keys are present before sending. No other
transaction from the multisig source may consume its sequence between build
and submission; if one does, discard the envelope and rebuild. Hardware
wallet support for this exact Soroban call must be proved in the rehearsal.
[Stellar's CLI guide](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/build-and-submit-transactions)
explains the build/simulate/sign/send split, and [Stellar's authorization
guide](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
confirms that G-account Soroban authorization obeys multisig thresholds.

### Step 4 — Verify ownership and privileged operations

Read the public entrypoint and confirm the multisig address:

```bash
stellar contract invoke --network testnet --source <FUNDED_READ_ACCOUNT> \
  --id <CONTRACT_ID> -- get_owner
```

Record the `own_acpt` event and transaction hash. Rehearse one authorized
issuer operation with two holders and prove a one-holder attempt fails. Repeat
for `pause`, `unpause`, and upgrade proposal/cancellation as allowed by the
current upgrade policy. Record every transaction hash and result.

### Step 5 — Retire the dev key

The dev-machine keypair used during testnet/initialization must not be used
for mainnet. It should be treated as burned after the handover is confirmed.

---

## 5. Acceptance criteria (tracking)

- [ ] Multisig account created with 2-of-3 threshold, all holders verified.
- [ ] Transfer rehearsed on testnet, all steps above executed and logged.
- [ ] `own_xfer` and `own_acpt` events confirmed on testnet ledger.
- [ ] `get_owner()` on testnet returns the multisig address, not a dev key.
- [ ] Mainnet deploy initializes directly to the multisig account (owner key
      never touches a developer workstation for the mainnet deployment).
- [ ] `docs/mainnet-readiness.md` §3.2 updated to ✅.

---

## 6. Out of scope

Implementing multisig in the contract — Stellar account-level multisig already
covers this requirement. No contract change is needed or recommended.
The existing `transfer_owner` / `accept_owner` mechanism is sufficient.
