# Acredia — Product Vision & Positioning

> The trust layer for academic credentials. Institutions issue tamper-proof credentials, students own them for life, and anyone verifies them in seconds — anchored on the Stellar blockchain.

**Status:** Living document · **Stage:** Production-ready on Stellar **testnet** (mainnet deferred) · **Owner:** Product

---

## 1. Vision & positioning (the one-pager)

**Vision.** A world where an academic achievement is instantly and freely verifiable by anyone, anywhere — where a degree can never be faked, lost, or held hostage by a portal that shuts down.

**Positioning statement.**
For **educational institutions** that need to issue credentials their graduates can trust and prove, **Acredia** is a **verifiable-credential platform** that anchors every credential to the Stellar blockchain and lets employers verify authenticity in seconds — unlike **paper/PDF documents** (easy to forge) and **centralized verification portals** (slow, siloed, and a single point of failure), Acredia makes credentials **tamper-proof, student-owned, and free to verify**.

### Problem
- **Fraud is easy and common.** Paper and PDF diplomas/transcripts can be edited or fabricated with off-the-shelf tools.
- **Verification is slow and manual.** Employers and institutions spend days emailing/calling registrars to confirm a single credential.
- **Records are fragile.** When a portal is decommissioned or a student loses access, proof of achievement can disappear.
- **Trust is centralized.** A single database is a single point of failure and a single point of control.

### Solution
Acredia gives each credential a **cryptographic fingerprint anchored on-chain** and keeps the credential and its document in private storage, shared only by the holder. Verification recomputes and matches that fingerprint — proving authenticity **without a phone call and without exposing private data**.

- **Institutions** issue credentials in minutes and can revoke them if needed, with a full audit trail.
- **Students** hold their credentials for life in a wallet-linked dashboard and share a link or QR code.
- **Anyone** verifies authenticity instantly and for free — no account required.

### Why Stellar
- **Sub-cent fees** make issuing at scale (thousands of credentials per term) economically viable.
- **3–5 second settlement** gives near-instant issuance and verification.
- **Energy-efficient, battle-tested, decentralized** infrastructure with native Rust smart contracts (Soroban) — no single point of failure, and no proof-of-work energy cost.
- **Global reach** aligned with a network built for financial inclusion — fitting for credentials that must be recognized across borders.

### Why now
- **Digital credentialing is going mainstream** (micro-credentials, bootcamps, professional certs) and demand for portable, verifiable proof is rising.
- **Open standards have matured** (W3C Verifiable Credentials, Open Badges 3.0), making interoperability realistic rather than aspirational.
- **Credential fraud is a growing, well-documented problem**, and remote hiring has multiplied the number of verifications employers must perform.
- **On-chain fees are now low enough** (sub-cent on Stellar) that anchoring every credential is affordable at institutional scale.

---

## 2. Market & ideal customer profile (ICP)

**Category:** Verifiable credentials / academic-credential infrastructure.

**Primary ICP (beachhead).** Small-to-mid-size, innovation-friendly **issuers of high-verification-demand credentials**:
- Coding bootcamps, professional-training providers, and certification bodies.
- Individual departments or continuing-education units within universities.

Why start here: shorter sales cycles than large universities, credentials that are verified frequently (so the value is immediate), and stakeholders comfortable adopting new technology.

**Expansion ICP.** Full universities/colleges and national skilling programs (longer cycles, higher volume, procurement-driven).

**Non-goals (for now).** Consumer-only "self-attested" badges with no issuing authority; mainnet token speculation; identity/KYC as a standalone product.

---

## 3. Personas & jobs-to-be-done (JTBD)

| Persona | Who they are | Job-to-be-done (JTBD) |
|---|---|---|
| **Institution admin / decision-maker** | Registrar office lead, program director, IT/innovation lead | "When my institution issues credentials, I want them to be impossible to forge and effortless to verify, so we protect our reputation and cut verification workload." |
| **Registrar / issuing staff** | The person who actually issues credentials each term | "When I issue credentials, I want a fast, reliable, bulk-friendly workflow with an audit trail, so I can process many students without errors." |
| **Student / graduate** | Recent or past graduate, job seeker | "When I apply for jobs or further study, I want to prove my achievements instantly and keep them for life, so I never depend on a slow portal or lose my records." |
| **Employer / verifier** | Recruiter, HR, ATS platform, admissions office | "When I receive a credential, I want to confirm it's genuine in seconds and for free, so I can hire/admit confidently without chasing registrars." |
| **Platform admin / operator** | Acredia operator governing trust | "When institutions apply to issue, I want to vet and authorize only legitimate issuers, so credentials on Acredia stay trustworthy." |

---

## 4. Value proposition per persona

- **Institution admin** — *Protect your brand, cut costs.* Fraud-proof credentials and near-zero verification overhead; a modern, differentiating signal to prospective students.
- **Registrar / issuing staff** — *Issue in minutes, not hours.* Guided issuance (and, on the roadmap, bulk CSV import), one-click revocation, and a clear record of every action.
- **Student / graduate** — *Own it for life.* One dashboard for every credential, shareable by link/QR, portable across borders and independent of any single institution's portal.
- **Employer / verifier** — *Verify instantly, free.* Confirm authenticity (and, on the roadmap, integrity and revocation status) in seconds from a QR code or link — no login, no back-and-forth.
- **Platform admin** — *Govern trust.* Authorize only vetted issuers on-chain, with an auditable approval trail.

### Device reality check (ACREDIA-STELLAR#4)

The student persona above is a recent graduate and job seeker — in much of the
world, that is a phone-first user. Stating "own it for life" and "portable across
borders" only holds if the device they own can reach the product, so the current
limits are recorded here rather than left implicit:

| Journey | Phone | Desktop |
| --- | --- | --- |
| Verify a credential (employer or student) | ✅ | ✅ |
| Sign in and view your dashboard | ✅ | ✅ |
| Share a link or QR code | ✅ | ✅ |
| Connect a wallet | ⚠️ needs WalletConnect configured | ✅ |
| Claim a credential issued to your address | ⚠️ needs WalletConnect configured | ✅ |
| Issue / revoke (institution) | ⚠️ | ✅ |

The constraint is that eight of the ten supported wallets are desktop browser
extensions. WalletConnect removes it and is implemented; it needs one deployment
setting (`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`). Until that is set, mobile users
are told what actually works on their device — never to install a browser
extension on a phone. See
[Connecting on a phone](../../README.md#connecting-on-a-phone).

**This table is a commitment to accuracy, not a target.** If a claim here stops
matching the product, the claim is the bug.

---

## 5. Differentiators (top 3 vs. incumbents)

**vs. Paper / PDF documents**
1. **Tamper-proof, not editable.** Authenticity is proven cryptographically against an on-chain anchor — not by a signature or watermark that can be copied.
2. **Instant, free verification.** No registrar call; anyone with the link/QR verifies in seconds.
3. **Permanent & portable.** The credential outlives any single file, folder, or email account.

**vs. Centralized verification portals (national clearinghouses, university portals)**
1. **No single point of failure or control.** The proof lives on a decentralized ledger; verification doesn't depend on one company's uptime or business survival.
2. **Student-owned, not gatekept.** Students hold and share their own credentials instead of paying/waiting for a portal to release them.
3. **Open and interoperable (roadmap).** Aligning with W3C VC / Open Badges 3.0 means credentials work across wallets and HR systems, not just inside one walled garden.

**vs. Other blockchain-credentialing platforms**
1. **Cost & speed built for scale.** Stellar's sub-cent fees and 3–5s settlement make anchoring *every* credential affordable — many chains make per-credential issuance too expensive.
2. **Privacy-first by design (roadmap).** Only a hash goes on-chain; documents are encrypted, so a public ledger never exposes student PII.
3. **Governed issuer trust.** A vetting/authorization workflow (KYB) ensures only legitimate institutions can issue — the credential's value comes from *who* issued it, not just that it's on a chain.

---

## 6. Business model & pricing

**Principle:** *Issuers pay; verification is always free.* Free, unlimited public verification maximizes network value and adoption; institutions capture that value and pay for issuance and tooling.

### Revenue streams
1. **Per-credential issuance fee** — a small fee per issued credential (covers on-chain and storage costs plus margin). Naturally usage-based and aligned with institution value.
2. **Institution subscription tiers** — recurring plans bundling issuance volume, seats, branding, analytics, and support.
3. **Verification API / partner access (roadmap)** — paid, higher-limit API keys and embeddable widgets for ATS/HR platforms that verify at scale (public one-off verification stays free).
4. **Value-added services (later)** — custom credential templates/branding, bulk import tooling, SSO, and premium support/SLAs.

### Illustrative pricing tiers (directional, not final)
| Tier | Audience | Includes | Pricing shape |
|---|---|---|---|
| **Free / Pilot** | Evaluators, small programs | Low monthly issuance cap, core dashboard, public verification | $0 |
| **Growth** | Bootcamps, departments | Higher issuance volume, bulk import, branding, basic analytics | Monthly subscription + per-credential over cap |
| **Institution** | Universities, cert bodies | High volume, SSO, advanced analytics, verification API, SLA | Annual contract + volume-based |

**Always free:** public verification for employers and individuals (no account, no fee).

**Unit-economics note:** on Stellar testnet the on-chain cost is effectively zero; on mainnet the marginal cost per credential is sub-cent plus document storage — so the per-credential fee is almost entirely margin, and free verification costs only read/RPC and bandwidth.

---

## 7. Go-to-market (motion, brief)

1. **Land** design-partner issuers (bootcamps / departments) with a free pilot; issue a real cohort's credentials.
2. **Prove value** through frequent employer verifications (the credential gets used, not shelved).
3. **Expand** within the institution (more programs/departments) and convert to paid tiers.
4. **Distribute** via verifiers: embeddable "Verify with Acredia" widget + API pulls employers/ATS into the ecosystem, which pulls in more issuers (two-sided network effect).
5. **Standards & trust** (issuer registry, VC/OBv3 export) make Acredia credentials recognized beyond the platform.

---

## 8. Success metrics (KPIs)

**North-star metric:** **verified credentials in use** — credentials that have been issued *and* verified at least once (proof the network creates real value, not just storage).

**Acquisition & supply (issuers)**
- Institutions **applied → verified (KYB) → actively issuing**.
- Time-to-first-credential for a new issuer.

**Core usage**
- **Credentials issued / month** (and cumulative).
- **Verifications / month** (and verifications per issued credential — the "usage" ratio).
- Active issuing institutions (issued ≥1 credential in the period).

**Retention & expansion**
- Issuer retention (month-over-month active issuers).
- Net revenue retention across tiers; expansion from Free → paid.
- Verification-API partners onboarded.

**Trust & reliability**
- Verification success rate and p95 verification latency.
- Credential availability (database and document storage health); incidents.

**Business**
- MRR/ARR by tier; per-credential revenue; gross margin per credential.
- CAC and payback for issuer accounts.

*Early-stage targets are set per quarter and tracked in the product dashboard once the analytics/indexer work (see backlog) lands. Numbers here describe the metric definitions, not current results — Acredia currently runs on testnet.*

---

## 9. Related documents

- **Roadmap / backlog:** [`ISSUE_DRAFTS.md`](../../ISSUE_DRAFTS.md) — the production & market issue backlog (this vision is issue #1).
- **Architecture:** `docs/architecture.md` *(planned — see backlog #25)*.
- **README:** [`README.md`](../../README.md) — project overview and setup.

---

*Scope reminder: Acredia is production-ready on **Stellar testnet**. Mainnet deployment/interaction is intentionally deferred — going live is a configuration switch once the mainnet-readiness checklist (backlog #6) is complete.*
