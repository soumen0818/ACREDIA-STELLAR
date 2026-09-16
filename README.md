<div align="center">
  <img src="frontend/public/Acredia.png" alt="Acredia Logo" width="150" />
  
  # ACREDIA
  ### Blockchain-Based Academic Credential Verification System
  
  *Secure, Transparent, and Tamper-Proof Educational Credentials on Stellar Network*

![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript)
![Soroban](https://img.shields.io/badge/Soroban-393939?style=for-the-badge&logo=stellar)
![Stellar](https://img.shields.io/badge/Stellar_Network-05192E?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase)
![IPFS](https://img.shields.io/badge/IPFS-65C2CB?style=for-the-badge&logo=ipfs)

---

### 🎯 Built on Stellar Network

**Cost-effective transactions** • **Fast settlement** • **Decentralized infrastructure** • **Native Soroban contracts**

[🌐 Stellar Network](https://stellar.org) | [📊 Stellar Expert Explorer](https://stellar.expert) | [💧 Get Test XLM](https://laboratory.stellar.org/)

**[🌐 Live app (Stellar testnet)](https://acredia-stellar-tau.vercel.app/)**

[Product Vision](docs/product/vision.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Why Stellar Network](#-why-stellar-network)
- [The Problem](#-the-problem)
- [Our Solution](#-our-solution)
- [Who Benefits](#-who-benefits)
- [Key Features](#-key-features)
- [Smart Contracts](#-smart-contracts)
- [Technology Stack](#-technology-stack)
- [Testing Strategy](#-testing-strategy)
- [System Architecture](#-system-architecture)
- [How It Works](#-how-it-works)
- [Getting Started](#-getting-started)
- [Environment Setup](#-environment-setup)
- [Usage Guide](#-usage-guide)
- [Project Structure](#-project-structure)
- [Documentation](#-documentation)
- [Contributing](#-contributing)

---

## 🌟 Overview

**Acredia** is a decentralized platform that transforms how academic credentials are issued, stored, and verified. Built on the **Stellar network** — designed for fast, low-cost, globally accessible transactions — Acredia combines a Soroban smart contract, IPFS storage, and a modern web app to eliminate credential fraud, cut verification time from days to seconds, and give students lifetime ownership of their records.

> **Vision.** The trust layer for academic credentials: institutions issue tamper-proof credentials, students own them for life, and anyone verifies them in seconds — for free.
>
> For the full product vision, personas, differentiators, and business model, see **[docs/product/vision.md](docs/product/vision.md)**.

### Why Acredia?

Traditional paper-based or centralized digital credentials suffer from:

- Easy forgery and tampering
- Time-consuming verification processes
- Risk of loss or damage
- Limited accessibility
- Centralized control and single points of failure

Acredia solves these problems by creating **immutable, blockchain-verified credentials** that are:

- ✅ Permanent and tamper-proof
- ✅ lntly verifiable
- ✅ Decentralized and censorship-resistant
- ✅ Accessible anywhere, anytime
- ✅ Privacy-preserving with student control

---

## 🚀 Why Stellar Network?

Acredia is built on **Stellar Network**, a decentralized network focused on providing financial inclusion and fast, low-cost transfers of assets globally:

### Key Benefits

**💰 Cost-Effective Transactions**

- Minimal transaction fees (less than a cent)
- Makes credential issuance affordable for educational institutions worldwide
- Students can claim credentials without significant costs

**⚡ Fast Settlement**

- Transaction finality in 3-5 seconds
- Instant credential verification
- Improved user experience with near-instant confirmations

**🌍 Global Reach & Accessibility**

- Designed for global financial inclusion
- Works on low-bandwidth connections
- Accessible from anywhere in the world

**🔒 Decentralized Infrastructure**

- No single point of failure
- Community-run validator network
- Battle-tested since 2014

**♻️ Energy Efficient**

- Minimal energy consumption
- Uses consensus algorithm designed for efficiency
- Supports sustainable applications

### Network Details

- **Stellar Public Network**: Production network (Network ID: Public Global Stellar Network)
- **Stellar Testnet**: Testing environment with test XLM faucet
- **Block Explorer**: [Stellar Expert](https://stellar.expert)
- **RPC/API Endpoints**: Horizon API for reliable connections
- **Native Currency**: XLM (Lumens)

**Smart Contracts**: Soroban - Stellar's smart contract platform built on Rust

---





## 🎯 The Problem

The current academic credential system faces critical challenges:

1. **Credential Fraud**: Fake degrees and certificates cost employers billions annually
2. **Slow Verification**: Manual verification takes days or weeks
3. **Institutional Dependency**: Students rely on institutions to provide transcripts
4. **Data Loss**: Physical documents can be lost, damaged, or destroyed
5. **Privacy Concerns**: Sharing full credentials when only partial verification is needed

---



## 💡 Our Solution Is

Acredia creates a **three-layer verification system** powered by Stellar Network:

1. **Blockchain Layer**: Immutable credential records on Stellar Network using Soroban smart contracts
2. **Storage Layer**: Decentralized metadata storage on IPFS
3. **Database Layer**: Fast querying and indexing via Supabase

This architecture ensures credentials are:

- **Permanent**: Stored on blockchain forever
- **Cost-Effective**: Minimal transaction fees on Stellar Network make issuance affordable
- **Fast**: Near-instant transaction settlement
- **Verifiable**: Instant verification via token ID or QR code
- **Decentralized**: No single point of failure
- **Detailed**: Subject-wise marks, grades, and complete academic records
- **Accessible**: Students own their credentials via blockchain accounts

---

## 👥 Who Benefits

Acredia connects four roles around a single, shared source of truth. See the
[Usage Guide](#-usage-guide) for detailed walkthroughs and
[`docs/product/vision.md`](docs/product/vision.md) for the full product vision, personas, and business model.

| Role | What they get | How they use it |
|---|---|---|
| **🏛 Institutions** (universities, colleges, bootcamps, cert bodies) | Fraud-proof credentials and near-zero verification overhead. | 1. Get provisioned by an Acredia admin and accept your invite → 2. Connect a Stellar wallet → 3. Fill the issuance form (student, degree, subjects, document) → 4. Sign the transaction to mint the credential on-chain and pin the document to IPFS. Revoke anytime. |
| **🎓 Students / graduates** | Lifelong, portable ownership of their achievements. | 1. Receive an invite from your institution and link a wallet → 2. Receive credentials directly in the dashboard → 3. Share a verification link or QR code with employers → 4. Export/download the credential whenever needed. |
| **✅ Verifiers** (employers, ATS, admissions) | Instant, free authenticity checks. | 1. Open the shared link or scan the QR (or enter a token ID) on `/verify` → 2. See authenticity, revocation status, and credential details in seconds — **no account required**. |
| **🛡 Admins / operators** | Governance of who can be trusted to issue. | 1. Provision institutions and issue invite links → 2. Authorize legitimate issuers on-chain → 3. Monitor issuance/verification statistics. |

---

## ⚡ Key Features

### For Students

- **Digital Wallet**: Receive credentials as NFTs in your wallet
- **Instant Access**: View all credentials anytime, anywhere
- **Easy Sharing**: Generate QR codes or shareable verification links
- **Subject Details**: Access complete subject-wise marks and grades
- **Lifetime Ownership**: Credentials stored permanently on blockchain

### For Institutions

- **Simple Issuance**: Issue credentials with an intuitive web interface
- **Subject-Wise Records**: Add detailed marks, grades, and performance data
- **Batch Processing**: Upload credentials for multiple students
- **Blockchain Verification**: Each credential is verifiable on-chain
- **Authorization Control**: Admin-approved issuer system

### For Verifiers (Employers/Universities)

- **Instant Verification**: Verify credentials in seconds via token ID or QR code
- **Blockchain Proof**: Direct links to blockchain transactions
- **Complete Details**: View student information, institution, marks, and grades
- **No Login Required**: Public verification page accessible to anyone
- **Tamper-Proof**: Impossible to forge or modify credentials

### For Administrators

- **Authorization Management**: Approve institutions to issue credentials
- **System Statistics**: Real-time dashboard with credential counts
- **Contract Ownership**: Full control over smart contract parameters
- **Security**: Only contract owner can authorize new issuers

---

## 📜 Smart Contracts

Acredia uses a single unified Soroban smart contract, `AcrediaCredential`, written in Rust and deployed on the **Stellar network**.

### ✅ AcrediaCredential Contract — Live on Testnet

> **Contract ID**: `CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK`  
> **Network**: Stellar Testnet  
> **Owner / Deployer**: `GAMI3XDDII72W23RADNPPAZ2GYEZ2MTYXLETOU36R4ISXMQ7IURFEKFP`  
> **Deployed**: 2026-06-27 (Redeployed)
> **Explorer**: [View on Stellar Expert ↗](https://stellar.expert/explorer/testnet/contract/CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK)

This single contract replaces two separate EVM contracts (CredentialNFT + CredentialRegistry) with one unified Soroban contract written in Rust. Additionally, it features upgraded Next.js boundary protection to bypass `@stellar/stellar-sdk` object coercions on the browser.

**Purpose**: Issue, store, and verify academic credentials on Stellar Network

**Key Features**:

- Authorization system — only admin-approved institutions can issue credentials
- Immutable on-chain credential storage with IPFS metadata links
- Credential lookup by token ID or SHA-256 hash
- Revocation mechanism with issuer-only control
- Timestamp-based issuance records via `env.ledger().timestamp()`

**Contract Functions**:

| Function | Access | Description |
|---|---|---|
| `initialize(owner)` | One-time | Initialize contract with owner address |
| `authorize_issuer(issuer)` | Owner only | Grant institution credential issuance rights |
| `revoke_issuer(issuer)` | Owner only | Remove institution authorization |
| `is_authorized_issuer(issuer)` | Public | Check if address is an authorized issuer |
| `issue_credential(student, issuer, hash, uri)` | Authorized issuers | Mint a new credential, returns `token_id` |
| `revoke_credential(token_id, issuer)` | Issuer only | Revoke an issued credential |
| `get_credential(token_id)` | Public | Fetch full credential struct by ID |
| `verify_credential(hash)` | Public | Look up credential by SHA-256 hash |
| `is_revoked(token_id)` | Public | Check revocation status |
| `total_credentials()` | Public | Get total credentials ever issued |

**Storage Architecture**:
- `DataKey::Authorized(Address)` → `instance` storage (low-cost, ephemeral)
- `DataKey::Credential(u64)` → `persistent` storage (permanent, survives ledger closings)
- `DataKey::HashIndex(BytesN<32>)` → `persistent` storage (SHA-256 hash bytes → token_id index)

### Stellar Testnet Deployment (Active)

**Network**: Stellar Testnet  
**RPC Endpoint**: `https://soroban-testnet.stellar.org`  
**Horizon API**: `https://horizon-testnet.stellar.org`  
**Block Explorer**: [Stellar Expert (Testnet)](https://stellar.expert/explorer/testnet)

### Stellar Mainnet (Deferred — testnet now, mainnet later)

Acredia is **production-ready on Stellar testnet today**. Mainnet is deliberately **not yet enabled**.

The application is built so the move is a **configuration switch**
(`NEXT_PUBLIC_STELLAR_NETWORK` + contract addresses) rather than a rewrite — but
configuration is not the only gate. Four blockers remain, and they are
governance and operational rather than code:

| Blocker | Status |
|---|---|
| Independent smart-contract audit | ❌ Not started |
| Contract owner key custody (multisig / HSM) | ❌ Not decided |
| Credential TTL keeper (funded + monitored) | ⚠️ Partial |
| Distributed rate limiting provisioned | ⚠️ Not provisioned |

**Current readiness: 5 of 11 areas complete.** The full, honest breakdown —
what is finished, what is not, and the exact cutover procedure — is in
**[docs/mainnet-readiness.md](docs/mainnet-readiness.md)**.
Operational runbooks (POC handover, recovery links, wallet changes) are in
**[docs/support-procedures.md](docs/support-procedures.md)**.

> **Safety rail:** a deployment configured for mainnet while still pointing at a
> known testnet contract **will refuse to boot**. This is intentional. Unsafe
> configuration fails loudly; merely-missing configuration degrades gracefully.

Mainnet endpoints, for reference:

**Network**: Stellar Public Network  
**RPC Endpoint**: `https://mainnet.sorobanrpc.com`  
**Horizon API**: `https://horizon.stellar.org`  
**Block Explorer**: [Stellar Expert](https://stellar.expert/explorer/public)

### 🔍 Smart Contract Verification Links (Important!)

All deployments, metadata hashes, and transaction executions can be publicly verified directly on the Stellar ledger explorer:

1. **Main Contract Viewer**: [AcrediaCredential Testnet Explorer ↗](https://stellar.expert/explorer/testnet/contract/CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK)
2. **Deployer Account Ledger**: [Stellar Account Overview ↗](https://stellar.expert/explorer/testnet/account/GAMI3XDDII72W23RADNPPAZ2GYEZ2MTYXLETOU36R4ISXMQ7IURFEKFP)
3. **Soroban RPC Instance**: `https://soroban-testnet.stellar.org`

> **⚠️ Important**: Always verify contract IDs on Stellar Expert before interacting with them. Never trust addresses from unofficial sources.

---

## 🛠 Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript | Web app + server API routes |
| **UI / styling** | Tailwind CSS v4, Radix UI, Framer Motion, Lucide | Design system, accessible primitives, motion, icons |
| **Auth** | Supabase Auth | Email/password sessions and JWTs |
| **Wallet** | Freighter (`@stellar/freighter-api`) | Stellar wallet connection & transaction signing |
| **Smart contract** | Rust + Soroban SDK | `AcrediaCredential` — issuance, authorization, revocation |
| **Blockchain** | Stellar (testnet) · Soroban RPC · Horizon | Ledger, contract calls, network queries |
| **Client SDK** | `@stellar/stellar-sdk` | Build / simulate / submit transactions, read contract state |
| **Storage** | IPFS via Pinata | Credential documents & metadata (encryption on the roadmap) |
| **Database** | Supabase (PostgreSQL) + Row Level Security | Off-chain index: profiles, credentials, verification logs |
| **Testing** | Vitest, Cargo test, `@vitest/coverage-v8` | Frontend, contract, and coverage |
| **Tooling** | npm, ESLint, Prettier, Stellar CLI, GitHub Actions | Dev, lint/format, deploy, CI |

---

## 🧪 Testing Strategy

Acredia employs a layered testing methodology across the smart contract, the frontend, and the Stellar SDK integration.

### 1. Smart Contract Constraints (Rust)
- **DataKey Validation**: Utilizing `#[contracttype]` enumerations rigorously enforces that unique contract state keys are tightly managed off-ledger, avoiding standard library allocation exceptions (`no_std`) required by Soroban.
- **Address Validation**: Hardened validation ensuring `symbol_short!` usage keeps within maximum string lengths, confirming valid G-Type Stellar identities.

### 2. Frontend Validation & Logic (Vitest)
Comprehensive unit testing utilizing `vitest` covering all utility logic natively on the UI structure:
- **Ledger Identity Matching**: `isValidAddress` accurately verifies if a 55-character string matches the absolute Stellar Ledger Public pattern (`^G[A-Z2-7]{54}$`).
- **State Transition Machine**: Business-logic evaluations (`getNextStatus`) verifying strict one-way credential progression: _Draft ➔ Pending_Issuance ➔ Issued ➔ Revoked_. Hard-coded safety blocks malicious regression.
- **Malicious Payload Defense**: Dynamic testing blocking inputs containing short strings, missing public keys, or invalid empty object injections before the transaction reaches the `Freighter` wallet prompt.

### 3. Edge-case SDK Resiliency (Implemented)
- **Freighter API v6 Compatibility**: Safe-parse bypass resolving `e.switch is not a function` by seamlessly handling both string and object responses (`signedTxXdr`) natively returned during wallet transaction signing.
- **RPC Parsing Fallback**: Strict bypasses for parsing `xdr.ScVal` primitives (like booleans) ensuring boolean RPC responses (e.g., `is_authorized_issuer`) do not crash if executed directly through client-side Javascript prototype boundaries.
- **Zero-Balance Accounts**: The simulation explicitly constructs dummy `Account` sequences (e.g., Sequence "0") to ensure read-only blockchain queries execute gracefully even if the user connects an unfunded `0 XLM` wallet.

---

## 🏗 System Architecture

```mermaid
graph TD
    U["Student · Institution · Verifier"]
    FE["Next.js App (React 19)"]
    FW["Freighter Wallet"]
    API["Next.js API Routes"]
    AUTH["Supabase Auth"]
    DB[("Supabase Postgres + RLS")]
    IPFS[("IPFS via Pinata")]
    SC["AcrediaCredential (Soroban)"]
    L[("Stellar Ledger")]

    U --> FE
    FE --> AUTH
    FE --> FW
    FE --> API
    FE -->|"read / verify (RPC)"| SC
    FW -->|"sign issue / revoke tx"| SC
    API --> DB
    API --> IPFS
    SC --> L

    style FE fill:#0ea5e9,color:#fff
    style SC fill:#f59e0b,color:#000
    style IPFS fill:#8b5cf6,color:#fff
    style DB fill:#10b981,color:#fff
    style AUTH fill:#10b981,color:#fff
```

> **Deeper dive:** see [`docs/architecture.md`](docs/architecture.md) for component responsibilities and the full issue / verify / revoke data flows, [`docs/verifiable-credentials.md`](docs/verifiable-credentials.md) for the W3C Verifiable Credential / Open Badges 3.0 metadata schema, field mapping, and a third-party verification recipe, and [`docs/ops/pin-redundancy.md`](docs/ops/pin-redundancy.md) for the IPFS pin-redundancy/keeper durability guarantee.

**Data flow (summary)**
- **Issue:** institution fills the form → document + metadata (modeled as a W3C VC / Open Badges 3.0 document) pinned to IPFS → SHA-256 hash computed over the canonical payload → issuer signs `issue_credential(student, issuer, hash, ipfs_uri)` via Freighter → the credential is written on-chain and indexed in Postgres.
- **Verify:** anyone opens `/verify` (token/QR) → the app reads the credential from the contract via Soroban RPC → shows authenticity + revocation status; a privacy-safe entry is recorded in `verification_logs`.
- **Revoke:** the original issuer signs `revoke_credential(token_id, issuer)` → the on-chain record is flagged revoked (still readable, so verifiers see "revoked" not "missing") → the index is updated.

### Architecture Layers

1. **Presentation Layer**: User interfaces for students, institutions, and verifiers
2. **Application Layer**: Business logic, authentication, and API routes
3. **Blockchain Layer**: Smart contracts deployed on Stellar Network using Soroban for decentralized transaction processing
4. **Storage Layer**: IPFS for decentralized metadata storage ensuring data persistence
5. **Database Layer**: Supabase for fast queries and off-chain indexing with Row Level Security

### Why This Architecture?

**Global Reach**: Stellar Network's infrastructure is designed for global financial inclusion and accessibility

**Cost-Efficiency**: Minimal transaction fees on Stellar Network make the system economically viable for educational institutions worldwide

**Security**: Multi-layer approach ensures data integrity - blockchain for immutability, IPFS for decentralization, and Supabase for access control

**Performance**: Fast transaction settlement on Stellar Network provides excellent user experience

---

## 🔄 How It Works

### Credential Issuance Flow

```mermaid
sequenceDiagram
    participant Institution
    participant Frontend
    participant IPFS
    participant Blockchain
    participant Database
    participant Student

    Institution->>Frontend: Enter credential details
    Frontend->>IPFS: Upload metadata + documents
    IPFS-->>Frontend: Return IPFS hash
    Frontend->>Blockchain: Mint NFT with IPFS hash
    Blockchain-->>Frontend: Transaction confirmed
    Frontend->>Database: Store credential record
    Database-->>Frontend: Success
    Frontend->>Student: Send NFT to wallet
    Frontend-->>Institution: Credential issued successfully
```

### Verification Flow

```mermaid
sequenceDiagram
    participant Verifier
    participant Frontend
    participant Database
    participant IPFS
    participant Blockchain

    Verifier->>Frontend: Enter token ID or scan QR
    Frontend->>Database: Query credential data
    Database-->>Frontend: Return metadata
    Frontend->>IPFS: Fetch detailed metadata
    IPFS-->>Frontend: Return full data
    Frontend->>Blockchain: Verify on-chain status
    Blockchain-->>Frontend: Confirm validity
    Frontend-->>Verifier: Display verification result
```

### Step-by-Step Process

#### For Institutions (Issuing Credentials)

1. **Connect Wallet**: Institution connects authorized wallet (Stellar account)
2. **Enter Student Details**: Name, wallet address, credential type
3. **Add Academic Data**: Degree, major, GPA, issue date
4. **Add Subject Marks**: Subject name, marks obtained, maximum marks, grade
5. **Upload to IPFS**: System uploads metadata to decentralized storage
6. **Record on Blockchain**: Smart contract records credential on Stellar Network
7. **Database Record**: System creates searchable database entry
8. **Confirmation**: Student receives credential on Stellar blockchain

#### For Students (Viewing Credentials)

1. **Login**: Authenticate with email or wallet
2. **Dashboard**: View all issued credentials from Stellar
3. **Details**: Click credential to see complete information stored on Stellar blockchain
4. **Share**: Generate QR code or verification link
5. **Download**: Export credential details or share blockchain proof from Stellar Expert

#### For Verifiers (Checking Credentials)

1. **Access**: Navigate to public verification page (no login required)
2. **Input**: Enter credential token ID or scan QR code
3. **Verification**: System checks Stellar blockchain and IPFS
4. **Results**: View complete credential details with blockchain proof
5. **Confirmation**: Verify authenticity via Stellar Expert blockchain explorer link

---

## 🚀 Getting Started

### Clean Clone Quick Start

Use npm for the frontend. This repository commits `frontend/package-lock.json`, and CI installs with `npm ci`.

From a fresh clone:

```powershell
git clone https://github.com/soumen0818/ACREDIA-STELLAR.git
cd ACREDIA-STELLAR\frontend
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Then fill `frontend\.env.local`, run the Supabase SQL scripts listed below, and open [http://localhost:3000](http://localhost:3000).

> **TL;DR**: Install prerequisites, clone the repo, run `npm ci` in `frontend`, copy `frontend/.env.local.example`, run the two Supabase SQL scripts, and start `npm run dev`. Deploy the contract only if you changed contract code or need a fresh contract ID.

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20 recommended; v18 minimum) - [Download](https://nodejs.org/)
- **npm** (bundled with Node.js) - this repo includes `frontend/package-lock.json`
- **Git** - [Download](https://git-scm.com/)
- **Stellar CLI** - [Install Guide](https://developers.stellar.org/docs/build/guides/cli/install)
- **Rust** (for Soroban contracts) - [Install](https://www.rust-lang.org/tools/install)
- **Test XLM Tokens** - Get from [Stellar Testnet Faucet](https://laboratory.stellar.org/)

### Installation

1. **Clone the Repository**

```powershell
git clone https://github.com/soumen0818/ACREDIA-STELLAR.git
cd ACREDIA-STELLAR
```

2. **Install Frontend Dependencies**

```powershell
cd frontend
npm ci
```

3. **Install Contract Build Toolchain**

```powershell
cd ../contracts
# Install the WASM32 build target (one-time setup)
rustup target add wasm32v1-none
# Install Stellar CLI if not already installed
cargo install --locked stellar-cli
```

### Configuration

4. **Set Up Environment Variables**

Copy the canonical frontend example:

```powershell
cd ..\frontend
Copy-Item .env.local.example .env.local
```

Edit `frontend\.env.local` and replace placeholder values:

```env
# Smart Contract Addresses — Stellar Testnet (deployed 2026-06-27)
# Single unified AcrediaCredential contract (replaces separate NFT + Registry)
NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT=CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK
NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT=CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK

# Stellar Network Configuration
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
# Server-only (set in hosting secret store for production)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
VERIFICATION_LOG_HASH_SECRET=your_random_audit_hash_secret

# Admin access control
# Comma-separated list of emails that may access admin API routes.
# Admin accounts must be provisioned by a trusted Supabase/service-role process.
ADMIN_EMAIL_ALLOWLIST=admin@example.com

# Pinata IPFS (server-side only; set this in the frontend app environment)
PINATA_JWT=your_pinata_jwt_token
# Optional: custom Pinata gateway domain
# NEXT_PUBLIC_PINATA_GATEWAY=https://your-gateway.mypinata.cloud
```

For contract deployment secrets, copy the contract example only when you are deploying:

```powershell
cd ..\contracts
Copy-Item .env.example .env
```

Then edit `contracts\.env`:

```env
STELLAR_NETWORK=testnet
STELLAR_SOURCE_ACCOUNT=deployer
STELLAR_CONTRACT_ID=
```

> **Production warning**: Keep `SUPABASE_SERVICE_ROLE_KEY`, `PINATA_JWT`, `VERIFICATION_LOG_HASH_SECRET`, and all Stellar secret keys server-only. Never put server secrets in `NEXT_PUBLIC_*` variables, browser code, screenshots, logs, or GitHub issues.

### Database Setup

5. **Set Up Supabase Database**

Run the canonical SQL setup in your Supabase SQL Editor. Paste and run the
single consolidated file:

```
frontend/supabase/schema.sql
```

`schema.sql` creates every table, index, trigger, function and RLS policy the
app needs. **It is fully idempotent and safe to re-run** — existing objects are
skipped, missing ones are created, and no data is dropped. Run it again after
pulling changes to bring an older database up to date.

It is generated from `frontend/supabase/migrations/*.sql` (the source of truth).
After adding a migration, regenerate it with `npm run db:schema`. If you use the
Supabase CLI instead, `npx supabase db push` applies the same migrations.

### Smart Contract Deployment

The public testnet contract is already listed in `frontend/.env.local.example`. Skip this section unless you changed `contracts/src/lib.rs`, need an isolated test deployment, or are preparing a production deployment.

6. **Set Up Stellar Identity**

```powershell
# Generate a new Stellar account for deployment
stellar keys generate --network testnet deployer

# Fund the account with testnet XLM from Friendbot
stellar keys fund deployer --network testnet

# Confirm your address
stellar keys address deployer
```

7. **Build & Deploy AcrediaCredential Contract**

```powershell
cd contracts

# Step 1: Build the WASM binary
cargo build --target wasm32v1-none --release

# Step 2: Deploy to Stellar Testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source deployer \
  --network testnet
# => Returns: CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK

# Step 3: Initialize the contract with your admin address
stellar contract invoke \
  --id CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK \
  --source deployer \
  --network testnet \
  -- initialize \
  --owner $(stellar keys address deployer)

# Step 4: Authorize an institution to issue credentials
stellar contract invoke \
  --id CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK \
  --source deployer \
  --network testnet \
  -- authorize_issuer \
  --issuer <INSTITUTION_STELLAR_ADDRESS>
```

**For Mainnet deployment**, replace `--network testnet` with `--network public` and use a funded mainnet account.

> **📝 Note**: The contract is already deployed to testnet. You only need to re-deploy if you modify the contract code.

### Running the Application

8. **Start the Development Server**

```powershell
cd frontend
npm run dev
```

9. **Open in Browser**

Navigate to [http://localhost:3000](http://localhost:3000)

### Production Build

```powershell
cd frontend
npm ci
npm run build
npm start
```

Before deploying to production:

- **Switch to Mainnet**: Set `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` in your production environment variables to point the application to the live Stellar network.
- **Keep one network switch**: Use only `NEXT_PUBLIC_STELLAR_NETWORK` (`testnet`, `mainnet`, or `custom`). Testnet/Mainnet profiles are boot-time validated and endpoint/passphrase overrides are blocked.
- **Configure Rate Limiting**: Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in your production environment to enable distributed rate limiting and caching. The public verification endpoint will fail-closed in production if this is not configured.
- **Update Contract Addresses**: Ensure `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT` and `NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT` are updated to your verified mainnet deployment IDs. (The app will fail to boot if it detects the known testnet contract on mainnet).
- Use Stellar Public Network values only after contract review and a verified mainnet deployment.
- Rotate any secret that was pasted into chat, screenshots, logs, browser code, or an issue.
- Set server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PINATA_JWT`, `VERIFICATION_LOG_HASH_SECRET`, Stellar secret keys) only in the hosting provider's protected environment variables.
- Configure Custom SMTP in Supabase (Gmail SMTP or dedicated provider) to avoid built-in ~3/hour send caps and spam filtering.
- Confirm Supabase RLS is enabled and production policies come from `frontend/supabase/schema.sql`.
- Verify contract IDs on Stellar Expert before pointing users at a production environment.

See `SECRETS_ROTATION.md` for the complete key-rotation runbook and pre-commit/CI secret-scan workflow.


---

## ⚙️ Environment Setup

### Getting API Keys

#### Pinata IPFS Setup

1. Visit [Pinata](https://pinata.cloud) and sign up for free (no credit card required)
2. Go to **API Keys** → **New Key**
3. Enable **all four** permissions the app uses — an under-scoped key fails at runtime:

   | Permission | Used by |
   |---|---|
   | `pinFileToIPFS` | uploading credential documents |
   | `pinJSONToIPFS` | uploading credential metadata |
   | `unpin` | account erasure (GDPR right to erasure) |
   | `pinList` | pin-keeper health checks / redundancy monitoring |

4. Copy the **JWT** token
5. Add it to your frontend `.env.local` as `PINATA_JWT=...` so only the server routes can use it.
   Never name it `NEXT_PUBLIC_PINATA_JWT` — the app refuses to boot if a server secret is
   exposed to the browser bundle.

> **Free tier**: 1 GB storage, unlimited pins — more than enough for development and testing.

#### Supabase Setup

1. Create account at [Supabase](https://supabase.com)
2. Create a new project
3. Get your project URL and anon key from Settings > API
4. Run `frontend/supabase/schema.sql` in the Supabase SQL Editor (safe to re-run at any time).

#### Email Deliverability & Custom SMTP Configuration

Acredia requires custom SMTP to avoid the strict ~3/hour send cap on Supabase's default mailer.

- **Zero-Cost Setup (Gmail SMTP):** Under **Supabase Dashboard → Project Settings → Authentication → SMTP Settings**, configure:
  * **Host:** `smtp.gmail.com` | **Port:** `587` | **Security:** `STARTTLS`
  * **User:** `<project_email>` | **Password:** `<Google App Password>`
  * **Daily Limit:** ~500 emails/day
- **Upgrade Trigger:** Migrate to a dedicated transactional provider (Resend, Postmark, SendGrid) when daily volume exceeds 300 emails or when custom sending domain SPF/DKIM/DMARC alignment is required for university firewalls.
- **Deliverability Fallback:** Admins can generate single-use, 24-hour expiring reset/invite links directly from `/admin/institutions/[id]` for direct handoff.
- **POC Handover:** Formal identity-verified handover with deactivation of prior accounts and audit logging is supported directly in the admin console.
- **Guide & Runbooks:** See [Email Configuration](docs/ops/email-configuration.md) and [POC Handover Runbook](docs/ops/poc-handover.md).

#### Stellar Account Setup

1. Create Stellar account using Stellar CLI:
   ```bash
   stellar keys generate --network testnet admin
   ```
2. Fund your account with test XLM:
   ```bash
   stellar keys fund admin --network testnet
   ```
3. Get your public key: `stellar keys address admin`
4. For testnet, fund from [Stellar Testnet Faucet](https://laboratory.stellar.org/)

### Wallet Setup for Stellar Network

1. **Install Stellar Wallet** (Options):
   - [Stellar Laboratory](https://laboratory.stellar.org/) - Web-based
   - [Freighter Wallet](https://www.freighter.app/) - Browser extension (recommended)
   - [StellarTerm](https://stellarterm.com/) - Web interface

2. **Create or Import Wallet**:
   - Generate new Stellar keypair or import existing
   - Save your secret key securely (never share!)

3. **Configure for Testnet**:
   - Network: `Stellar Testnet`
   - Horizon API: `https://horizon-testnet.stellar.org`
   - Soroban RPC: `https://soroban-testnet.stellar.org`
   - Network Passphrase: `Test SDF Network ; September 2015`

4. **Get Test XLM Tokens**:
   - Visit [Stellar Testnet Faucet](https://laboratory.stellar.org/)
   - Click "Get Test Network Lumens"
   - Select Account ID
   - Enter your public key
   - Request 10,000 test XLM
   - Tokens arrive instantly

5. **For Mainnet Deployment** (Production):
   - Network: `Stellar Public Network`
   - Horizon API: `https://horizon.stellar.org`
   - Soroban RPC: `https://mainnet.sorobanrpc.com`
   - Network Passphrase: `Public Global Stellar Network ; September 2015`
   - Purchase XLM from exchange or use peer-to-peer transfers

---

## 📖 Usage Guide

> **Access model.** Acredia is closed and delegated: there is no public sign-up.
> Acredia admins provision institutions, institutions provision their students,
> and each new account is reached through a single-use invite link on which the
> recipient sets their own password. Credential verification at `/verify` stays
> fully public and needs no account at all.

### For Administrators

**Provisioning an Institution**

1. Navigate to Admin Dashboard > Institutions
2. Click "Add institution"
3. Enter the institution name, POC name and email, and issuer wallet address
4. Save — the institution is created as `pending` and an invite link is generated
5. Copy the invite link (it is also emailed) and send it to the POC
6. The POC opens the link and sets their own password; no Acredia staff ever sees it

Creating the record deliberately does **not** authorize the wallet on-chain —
that is the separate, owner-signed step below.

**Authorizing Institutions**

1. Connect the contract owner wallet
2. Navigate to Admin Dashboard
3. Enter institution wallet address
4. Click "Authorize Wallet"
5. Confirm blockchain transaction
6. Institution can now issue credentials

### For Institutions

**Issuing a Credential**

1. Login with your provisioned institution account
2. Go to Dashboard > Issue Credential tab
3. Fill in student details:
   - Student Name
   - Student Wallet Address
   - Credential Type (Degree, Certificate, etc.)
   - Degree/Major/GPA
   - Issue Date
4. Add subjects (click "+ Add Subject"):
   - Subject Name
   - Marks Obtained
   - Maximum Marks
   - Grade (optional)
5. Click "Issue Credential"
6. Confirm wallet transaction
7. Wait for confirmation
8. Student receives NFT in their wallet

**Viewing Issued Credentials**

1. Go to Dashboard > Issued Credentials tab
2. View all credentials issued by your institution
3. See blockchain transaction hashes
4. Access IPFS metadata links

### For Students

**Viewing Your Credentials**

1. Login with the student account your institution provisioned for you
2. Dashboard displays all your credentials
3. Click on any credential to see:
   - Institution details
   - Credential type and dates
   - Subject-wise marks and grades
   - Overall performance statistics
   - Blockchain verification proof

**Sharing Credentials**

1. Click "Share" on any credential
2. Options:
   - Generate QR Code
   - Copy verification link
   - Share token ID
3. Recipients can verify without login

### For Verifiers (Employers/Universities)

**Verifying Credentials**

1. Go to verification page (no login required)
2. Enter credential token ID OR scan QR code
3. View complete credential details:
   - Student information
   - Issuing institution
   - Academic records
   - Subject-wise performance
   - Blockchain proof
4. Click blockchain link to verify on Stellar Expert
5. Confirm credential is authentic and not revoked on Stellar Network

---

## 📁 Project Structure

### Frontend Directory Structure

```
frontend/
├── public/
│   ├── logo.png                    # Acredia logo
│   ├── Acredia.png                 # Brand logo (favicon/icon source)
│   ├── favicon.ico / icon.png      # Site icons
│   └── auth-illustration.png       # Marketing illustration
├── src/
│   ├── app/
│   │   ├── page.tsx               # Landing page
│   │   ├── layout.tsx             # Root layout with providers
│   │   ├── globals.css            # Global styles
│   │   ├── about/
│   │   │   └── page.tsx           # About page
│   │   ├── admin/
│   │   │   └── page.tsx           # Admin dashboard
│   │   ├── api/
│   │   │   └── admin/
│   │   │       ├── stats/route.ts          # Statistics API
│   │   │       └── update-authorization/   # Authorization sync
│   │   ├── auth/
│   │   │   ├── login/             # Student/Institution login
│   │   │   ├── accept-invite/     # Invited POC sets their own password
│   │   │   ├── admin-login/       # Admin authentication
│   │   │   └── admin-setup/       # Initial admin setup
│   │   ├── dashboard/
│   │   │   └── page.tsx           # User dashboard
│   │   └── verify/
│   │       └── page.tsx           # Public verification page
│   ├── components/
│   │   ├── institution/
│   │   │   ├── AuthorizeIssuer.tsx           # Authorization UI
│   │   │   ├── CredentialUploadForm.tsx      # Issuance form
│   │   │   └── IssuedCredentialsList.tsx     # Issued credentials
│   │   ├── student/
│   │   │   ├── StudentCredentialsList.tsx    # Student's credentials
│   │   │   ├── QRCodeModal.tsx              # QR code display
│   │   │   └── CredentialDiagnostic.tsx     # Debug component
│   │   ├── verification/
│   │   │   └── (verification components)
│   │   ├── shared/
│   │   │   └── (shared components)
│   │   └── ui/
│   │       ├── button.tsx         # Button component
│   │       ├── card.tsx           # Card component
│   │       ├── input.tsx          # Input component
│   │       ├── form.tsx           # Form components
│   │       └── (other UI primitives)
│   ├── contexts/
│   │   └── AuthContext.tsx        # Authentication context
│   ├── hooks/
│   │   └── useAuth.ts             # Authentication hook
│   ├── lib/
│   │   ├── contracts.ts           # Smart contract interactions
│   │   ├── credentialService.ts   # Credential issuance service
│   │   ├── ipfs.ts                # IPFS upload utilities
│   │   ├── supabase.ts            # Supabase client
│   │   ├── stellar.ts             # Stellar/Soroban configuration
│   │   └── utils.ts               # Utility functions
│   └── types/
│       └── index.ts               # TypeScript type definitions
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
├── next.config.ts                  # Next.js configuration
├── tailwind.config.js              # Tailwind CSS config
├── postcss.config.mjs              # PostCSS config
└── components.json                 # Shadcn UI config
```

### Contracts Directory Structure

```
contracts/
├── src/
│   └── lib.rs                     # Soroban Smart Contract
├── Cargo.toml                     # Rust/Soroban dependencies
├── Makefile                       # Build and deployment scripts
└── target/                        # Compiled WASM build output
```

### Database Schema (Supabase)

```
credentials
├── id (uuid)
├── token_id (bigint) - NFT token ID
├── student_id (uuid) - Reference to students
├── institution_id (uuid) - Reference to institutions
├── ipfs_hash (text) - IPFS metadata hash
├── blockchain_hash (text) - Transaction hash
├── metadata (jsonb) - Credential details
├── metadata_schema_version (integer) - Canonical metadata schema version
├── hash_algorithm (text) - Hash algorithm identifier
├── issued_at (timestamp)
├── revoked (boolean)
├── revoked_at (timestamp)
├── student_wallet_address (text)
└── issuer_wallet_address (text)

students
├── id (uuid)
├── email (text)
├── name (text)
├── wallet_address (text)
└── created_at (timestamp)

institutions
├── id (uuid)
├── email (text)
├── name (text)
├── wallet_address (text)
├── verified (boolean)
└── created_at (timestamp)

verification_logs
├── id (uuid)
├── credential_id (uuid)
├── created_at (timestamp)
└── verification_result (jsonb)
```

### Credential Metadata Hashing

Credential hashes are derived from a versioned canonical payload, not directly from raw `JSON.stringify(metadata)`.

- Current schema: `metadata_schema_version = 1`
- Current algorithm: `hash_algorithm = sha256:canonical-json:v1`
- Legacy schema: `metadata_schema_version = 0`, `hash_algorithm = sha256:json-stringify`
- Shared implementation: `frontend/src/lib/credentialHash.ts`
- Stellar byte encoding: `frontend/src/lib/credentialHashEncoding.ts`
- Test vectors: `frontend/tests/credentialHash.test.ts`

Schema v1 hashes only the credential meaning needed for verification: name, description, image, student wallet/name, credential type, degree, major, GPA, issue date, institution name, and normalized subjects. Optional fields are represented as `null` or empty arrays, numeric-like values are converted to strings where the UI treats them as text, ISO date-times are normalized to `YYYY-MM-DD`, and object keys are serialized in sorted canonical order.

Future metadata fields can be added to stored `metadata` or IPFS display metadata without changing old hashes. To make a new field part of the on-chain digest, add a new schema version and algorithm identifier, keep the v1 builder intact, add new fixed test vectors, store the new version on newly issued credentials, and keep verification dispatching by each row's stored `metadata_schema_version` and `hash_algorithm`.

---

## 🔐 Security Features

### Smart Contract Security

- **Rust & Soroban**: Memory-safe and highly deterministic smart contracts
- **Access Control**: Only authorized issuers can mint credentials
- **Owner Authorization**: Contract owner controls authorization
- **Soroban Security**: Built-in protections against common smart contract vulnerabilities

### Application Security

- **Row Level Security (RLS)**: Supabase database policies
- **Wallet Authentication**: Cryptographic signature verification
- **Environment Variables**: Sensitive data never committed
- **HTTPS Only**: All production traffic encrypted
- **Public Verification**: No authentication required for verification

### Data Privacy

- **Student Control**: Students own their credential NFTs
- **Selective Disclosure**: Share only what's necessary
- **IPFS Storage**: Decentralized, censorship-resistant
- **No PII on Blockchain**: Personal data only in IPFS/database

---

## 🎨 Design Philosophy

Acredia follows modern web design principles:

- **Responsive**: Works on desktop, tablet, and mobile
- **Accessible**: WCAG 2.1 compliant components
- **Consistent**: Unified design system with Tailwind CSS
- **Intuitive**: Clear user flows and interactions
- **Professional**: Gradient accents and modern aesthetics
- **Fast**: Optimized with Next.js App Router

---

## 🧪 Testing

### Running Tests

```powershell
# Contract tests (Rust based)
cd contracts
cargo test

# Build WASM
cargo build --target wasm32v1-none --release

# Frontend tests (if configured)
cd frontend
npm test
```

### Testing on Stellar Testnet

**Before testing, ensure:**

1. Freighter Wallet is connected to Stellar Testnet
2. You have sufficient test XLM tokens in your wallet
3. Environment variables are properly configured

### Manual Testing Checklist

**Network & Wallet**

- [ ] Freighter Wallet connected to Stellar Testnet
- [ ] Test XLM tokens available in wallet
- [ ] Contract addresses correct in `.env.local`

**Credential Issuance**

- [ ] Institution can issue credential on Stellar Network
- [ ] Transaction completes within 3-5 seconds
- [ ] Student receives NFT in wallet
- [ ] Metadata uploaded to IPFS successfully
- [ ] Database record created with correct chain data
- [ ] Subject-wise marks displayed correctly
- [ ] Gas fees are minimal (< $0.01)

**Verification**

- [ ] Public verification page loads
- [ ] Token ID search works
- [ ] QR code scanning works
- [ ] Stellar Expert blockchain link redirects correctly
- [ ] Subject table displays properly
- [ ] Transaction hash verifiable on Stellar Expert

**Authorization**

- [ ] Admin can authorize institutions
- [ ] Unauthorized wallets cannot issue
- [ ] Authorization status updates in database

---

## 🚧 Roadmap

> The full, current production & market backlog (25 issues covering privacy, standards, indexer/worker, verification API, docs, and more) lives in **[ISSUE_DRAFTS.md](ISSUE_DRAFTS.md)**. The phases below are a high-level summary.

### Phase 1: Core Features ✅

- [x] Smart contract development
- [x] NFT credential issuance
- [x] IPFS metadata storage
- [x] Public verification page
- [x] Subject-wise marks system

### Phase 2: Enhanced Features 🚧

- [ ] Bulk credential issuance
- [ ] Advanced filtering and search
- [ ] Email notifications
- [ ] PDF certificate generation
- [x] Stellar Network integration (Fast and low cost)

### Phase 3: Advanced Features 📋

- [ ] Credential revocation UI
- [ ] Decentralized identity (DID) integration
- [ ] Mobile ins
- [ ] API for third-party integrations
- [ ] Analytics dashboard
- [ ] Cross-chain credential verification

### Phase 4: Enterprise Features 🔮

- [ ] Institutional dashboards
- [ ] Batch operations
- [ ] Advanced reporting
- [ ] White-label solutions
- [ ] Compliance tools
- [ ] Stellar Mainnet production deployment

---

## 🐛 Troubleshooting

### Common Issues

**Problem: Freighter Wallet not connecting**

- Solution: Ensure you're on Stellar Testnet and site permissions are granted
- Refresh the page and try connecting again

**Problem: "Wrong Network" error**

- Solution: Switch to Stellar Testnet in your wallet settings

**Problem: Transaction failing**

- Solution: Check you have enough test XLM tokens in your wallet
- Verify wallet is authorized to issue credentials (for institutions)
- Ensure your sequence number is correct

**Problem: Contract deployment fails**

- Solution: Verify your identity is funded on testnet (`stellar keys fund deployer --network testnet`)
- Ensure sufficient XLM balance for deployment
- Check Soroban SDK version compatibility in Cargo.toml

**Problem: IPFS upload timeout / failed**

- Ensure `PINATA_JWT` is set in your frontend `.env.local`
- Verify the JWT is valid at [app.pinata.cloud](https://app.pinata.cloud)
- Check your internet connection and try again
- Free tier is limited to 1 GB — check your Pinata dashboard usage

**Problem: Verification page shows "not found"**

- Solution: Ensure RLS policies are enabled in Supabase (run SQL scripts)
- Check contract addresses in `.env.local` are correct
- Verify token ID exists on blockchain

**Problem: Subjects not displaying**

- Solution: Clear browser cache and reload page
- Ensure IPFS metadata contains subjects array
- Check IPFS gateway is accessible

## 📚 Documentation

Deeper documentation lives under [`docs/`](docs/):

- **[Product Vision & Positioning](docs/product/vision.md)** — what Acredia is, who it's for, personas, differentiators, and the business model.
- **[Architecture](docs/architecture.md)** — components, layers, and the issue / verify / revoke data flows.
- **[Authentication & roles](docs/auth-flow.md)** — how sessions, role resolution, and route guards work.
- **[Verifiable Credentials](docs/verifiable-credentials.md)** — the W3C VC / Open Badges 3.0 metadata schema, field mapping, and a third-party verification recipe.
- **[IPFS pin redundancy](docs/ops/pin-redundancy.md)** — the pin-keeper and the durability guarantee for issued credentials.
- **[Operations runbook](docs/ops/runbook.md)** — on-call procedures and incident response.
- **[Email configuration & deliverability](docs/ops/email-configuration.md)** — Supabase custom SMTP setup, sending limits, upgrade triggers, and fallback direct recovery links.
- **[POC handover runbook](docs/ops/poc-handover.md)** — defensible identity verification procedure, account deactivation, and audit trail for institutional turnover.
- **[Multi-user institution decision (ADR 0003)](docs/decisions/0003-multiple-institution-users.md)** — architectural decision record on multiple users per institution for business continuity.
- **[Contract reference](contracts/README.md)** — the Soroban `AcrediaCredential` contract, storage/TTL model, and deployment.
- **[Roadmap & backlog](ISSUE_DRAFTS.md)** — the production & market issue backlog.
- **API reference** — _planned (see the "public verification API" item in the backlog)._

## 🤝 Contributing

Contributions are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow, coding standards, and how to run the test suite.

- **Security:** found a vulnerability? Follow the responsible-disclosure process in **[SECURITY.md](SECURITY.md)** — please do **not** open a public issue for security reports.
- **Issue labels:** `bug`, `docs`, `frontend`, `contracts`, `database`, `security`.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgements

Built with amazing open-source technologies:

- [Next.js](https://nextjs.org/) - React framework
- [Stellar Network](https://stellar.org/) - Decentralized network for global financial infrastructure
- [Pinata](https://pinata.cloud/) - Immutable IPFS file storage APIs
- [Supabase](https://supabase.com/) - Open-source Firebase alternative
- [Soroban SDK](https://stellar.org/soroban) - Native smart contracts platform for Stellar
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [Radix UI](https://www.radix-ui.com/) - Accessible component primitives
- [Lucide Icons](https://lucide.dev/) - Beautiful icon library
- [IPFS](https://ipfs.io/) - Decentralized storage network

## 📞 Contact & Support

For questions, feedback, or support:

- **Email:** [acredia.stellar@gmail.com](mailto:acredia.stellar@gmail.com)
- **Issues:** open one on [GitHub Issues](https://github.com/soumen0818/ACREDIA-STELLAR/issues) — check existing issues first
- When reporting a bug, include setup steps, affected file paths, expected behavior, actual behavior, and labels such as `bug`, `docs`, `frontend`, `contracts`, or `database`.
- **Security vulnerabilities:** do **not** open a public issue — email us instead.

---

<div align="center">
  
### Thank You!

**Making Academic Credentials Secure, Transparent, and Accessible on Stellar Network**

⭐ Star this repo if you find it helpful!

---
</div>
