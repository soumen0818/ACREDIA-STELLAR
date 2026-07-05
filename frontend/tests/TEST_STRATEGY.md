# Test Strategy: Core Academic Credential Lifecycle

This document describes the testing strategy and structural patterns utilized for validating the end-to-end credential lifecycle in **ACREDIA-STELLAR**.

---

## 🏗️ Core Design Pattern

Academic credential operations rely heavily on decentralized components (Stellar Soroban smart contracts, IPFS storage networks) and modern database APIs (Supabase). To ensure stable, local, and CI-compatible testing without hitting live blockchain node environments or third-party networks, we implement **fully mocked integration / E2E tests**.

```
┌────────────────────────────────────────────────────────┐
│               tests/e2e.lifecycle.test.ts              │
└───────────────────────────┬────────────────────────────┘
                            ▼ Mocks (using Vitest)
 ┌─────────────────┬─────────────────┬─────────────────┐
 │   IPFS Service  │  Stellar Network│  Supabase Client│
 └─────────────────┴─────────────────┴─────────────────┘
```

---

## 🧪 Verified Testing Scenarios

Located in [e2e.lifecycle.test.ts](./e2e.lifecycle.test.ts):

### 1. Successful Credential Issuance Lifecycle

- **Strategy**: Mock IPFS file and metadata storage, simulate a successful transaction sign and broadcast on the Stellar network (obtaining a valid token ID), and assert that the Supabase client inserts the exact metadata payload, mapping the token correctly.

### 2. Failed Wallet Signing (Freighter Rejection)

- **Strategy**: Configure Freighter signature simulators to throw rejected/canceled errors, verifying that the service fails gracefully, bubbles up transaction sign failures, and does **not** insert stray records into Supabase.

### 3. Verification Success States

- **Strategy**: Query the `/api/verify/[token]` handler with a mock request. Verify that the system dynamically calculates the stored schema version's credential metadata hash, checks it against the simulated on-chain registry, and returns `verification.verified: true`.

### 4. Verification Revoked States

- **Strategy**: Request validation of an issued credential where the on-chain Soroban query yields `isRevoked: true`. Verify that the route responds with `revoked: true` and `verification.verified: false` instantly.

### 5. Verification Not Found States

- **Strategy**: Query the verification API endpoint with an invalid or non-existent token ID. Verify that the response status is 404, with a descriptive "Credential not found" error payload.

### 6. Verification Mismatch States

- **Strategy**: Query verification for a token where the metadata stored in Supabase doesn't match the on-chain registered state (e.g. modified SHA-256 hash or altered wallet addresses). Assert that `verification.verified` resolves to `false`, public responses avoid granular mismatch internals, and the private audit log stores coarse mismatch reason codes.

### 7. Role-Based Access Validation

- **Strategy**: Validate route access patterns using mocked authentication states. Verify that the admin authorization guard helper (`requireAdminRequest`) resolves correctly for allowlisted admin emails and successfully denies student or unauthorized access roles.
