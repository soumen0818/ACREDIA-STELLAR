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

---

## 🛡️ Base-URL Identity Guard

**If a browser run fails before any test starts, with "Refusing to run the Playwright
suite against …", this is the section you want.**

### What it does

[global-setup.ts](./playwright/global-setup.ts) runs once, before any spec, and fetches
the configured base URL. It continues only if the response carries the Acredia marker —
a `<meta name="x-acredia-app" content="acredia-stellar">` tag emitted from the root
layout, so it is present on every route. Anything else aborts the run with an explicit
message naming the URL and how to fix it.

### Why it exists

`webServer.reuseExistingServer` attaches to whatever is already listening on the
configured port. Port 3000 is shared with roughly every other web project on a
developer's machine, and on 2026-09-26 the a11y suite attached to an unrelated CRM dev
server and reported four failures citing elements (`/objects/people`,
`navigation-drawer-item`) that exist nowhere in this repository (ACREDIA-STELLAR#271).

The false failures were the visible harm; the false *passes* were the real one. Another
app that happens to be accessible on the audited paths would report green while
Acredia's own regressions shipped unexercised — and nothing in the output would say the
audit had been pointed somewhere else.

### The three layers

| Layer | Mechanism | Covers |
| --- | --- | --- |
| Unlikely collision | Default port is **3199**, not 3000 | The everyday case |
| Detected collision | Global setup asserts the marker | A collision that happens anyway |
| No collision at all | `reuseExistingServer: !process.env.CI` | CI, which always starts its own server |

### Overriding the port

`PLAYWRIGHT_PORT` still works when 3199 is itself taken:

```bash
PLAYWRIGHT_PORT=3200 npx playwright test
```

### Changing the marker

The name and value live in [src/lib/appIdentity.ts](../src/lib/appIdentity.ts) and are
compared as strings. Changing one side alone breaks every browser run — the layout and
the guard must move together. [playwrightIdentityGuard.test.ts](./playwrightIdentityGuard.test.ts)
covers both, including a deliberate run against a non-Acredia responder that asserts the
setup fails rather than proceeding.

---

## 👛 Wallet testing

Acredia registers nine wallets through Stellar Wallets Kit
(ACREDIA-STELLAR#272). The automated suites cover the adapter's logic; the
per-wallet matrix below cannot be automated and has to be walked by a human.

### What is covered automatically

| Suite | Covers |
| --- | --- |
| [contractsInvoke.test.ts](./contractsInvoke.test.ts) | The full build → simulate → sign → submit → confirm sequence in `invokeContractMethod`, driven by a **keypair signer with no browser**. Verifies the submitted transaction really is signed by that keypair, not just that submit was called. Previously impossible (ACREDIA-STELLAR#3). |
| [stellarSigner.test.ts](./stellarSigner.test.ts) | The signer implementations: signatures verify against the public key, follow the passphrase they are told, and round-trip through the real server-side verifier. |
| [ledgerGateway.test.ts](./ledgerGateway.test.ts) | All six operations use one boundary; real signers reach real execution, fake writes fail without state, unauthorized calls reject, token ids remain sequential. |
| [e2eLedger.test.ts](./e2eLedger.test.ts) | The single E2E seam that replaced six inline `getE2eState()` forks, plus assertions that `contracts.ts` imports no wallet SDK and never calls `getE2eState`. |
| [walletPlatform.test.ts](./walletPlatform.test.ts) | Mobile device detection (including iPadOS's desktop UA) and which wallets a phone can actually reach — the judgements the mobile fix rests on (ACREDIA-STELLAR#4). |
| [walletAdapter.test.ts](./walletAdapter.test.ts) | Connect / restore / disconnect, capability gating, response normalisation, network selection, single-init under concurrency. Kit fully mocked. |
| [walletBoundary.test.ts](./walletBoundary.test.ts) | That no file outside `src/lib/wallet/` imports a wallet library, and that no copy presents Freighter as a requirement. Walks the source tree. |
| [walletModalA11y.test.ts](./walletModalA11y.test.ts) | That the modal's icon buttons are identified and labelled. Pins the kit's real SVG path data, so a kit upgrade that redraws an icon fails here. |
| [studentProvisioning.test.ts](./studentProvisioning.test.ts) | Signature normalisation across base64 / `Uint8Array` / hex, including a hex round-trip through verification. |
| [playwright/](./playwright/) | The full issue → verify → revoke cycle, with the wallet stubbed via E2E state. |

### What is **not** covered automatically

Two things, both by nature:

1. **Real wallet extensions.** Credential lifecycle specs seed E2E state.
   `walletModal.spec.ts` loads the real Kit modal without E2E state, but no
   extension is installed and no wallet approval is given.
2. **The response-shape differences that motivated the adapter.** The whole
   reason `contracts.ts` used to carry defensive XDR normalisation is that
   wallets differ in what they return. Mocks return what we told them to, so
   only a real wallet can prove the adapter handles it.

**Signing must therefore be re-verified per wallet.** A green CI run is not
evidence that a given wallet works.

### Per-wallet verification matrix

Run against testnet with an authorized issuer wallet. Record the result in the
PR that adds or upgrades a wallet.

| Wallet | Connect | Authorize issuer | Issue | Batch issue | Revoke | Claim (`/claim`) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Freighter | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| xBull | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Lobstr | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Hana | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Klever | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| OneKey | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Bitget | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| HOT Wallet | **disabled** | n/a | n/a | n/a | n/a | n/a |
| Albedo | ☐ | ☐ | ☐ | ☐ | ☐ | **n/a** — no message signing |
| Rabet | ☐ | ☐ | ☐ | ☐ | ☐ | **n/a** — no message signing |

For Albedo and Rabet, the `/claim` check is inverted: confirm the page **refuses
early** with a named explanation, rather than letting the form be filled and
failing at signing.

### Verification status — 2026-10-02

Verified in this environment, with evidence:

- ☑ The kit loads in a real browser and reports the registered wallets with
  availability resolved (`xBull — available`, `Freighter — not installed`, …).
- ☑ The modal opens, is keyboard-reachable, closes on `Escape`, and scores
  **0 axe violations across all rules** (down from 1 critical).
- ☑ Existing Playwright suite (12 specs, issue → verify → revoke) green.
- ☑ Three real-modal/CSP browser checks pass, including the 360px viewport.
- ☑ Adapter, boundary, a11y and normalisation suites green.

**Not verified — needs a human with the extensions installed:** every cell in
the matrix above. No browser wallet extension was installed in the migration
environment, so no real signature was ever produced. The adapter's handling of
each wallet's response is reasoned from the kit's module sources, not observed.

### Keyboard modal behavior

Acredia repairs the upstream missing Escape handler by activating the Kit's own
labelled close button. It also focuses the dialog, wraps Tab/Shift+Tab and
restores focus after dismissal. `playwright/walletModal.spec.ts` exercises the
actual installed Kit markup and axe; it does not seed a fake wallet.

The CSP probe in that spec uses the production policy with intercepted external
responses to distinguish an allowed transport from a browser CSP rejection.
Real WalletConnect and Albedo signing still require the manual matrix.

### Mobile (ACREDIA-STELLAR#4)

Measured in emulated mobile Chromium (iPhone 12, Pixel 5, 360px and 320px
Android), against the real kit modal:

| Check | Result |
| --- | --- |
| Wallets *reporting* available on mobile | xBull, Albedo, HOT Wallet |
| Wallets that **actually** work | Albedo only — the other two report `true` unconditionally |
| Modal at 360px | 352px wide, no horizontal page scroll, 0 axe violations |
| Modal at 320px | 320px wide, no overflow, 0 axe violations |
| Header tap targets | 34px before the fix → **44px** after (WCAG 2.5.5) |
| `/claim` on mobile | Shows the options notice; no "install extension" copy; offers a desktop route |

Two traps worth knowing if you touch this:

- **`isAvailable` is not trustworthy on mobile.** xBull and HOT both return
  `true` without checking anything. `src/lib/wallet/platform.ts` holds the real
  answer, and `walletPlatform.test.ts` pins it.
- **HOT Wallet is deliberately excluded.** Its module hardcodes
  `Networks.PUBLIC` and needs `global`/`Buffer` polyfills this app does not ship,
  so on testnet it would sign against the wrong ledger.

**Not verified here:** a real phone with a real wallet app. Everything above is
emulated Chromium, which reproduces layout, detection and a11y faithfully but
cannot prove a WalletConnect session end to end.

### WalletConnect (mobile)

**Implemented**, gated on `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free, from
[Reown](https://cloud.reown.com)). With no id set the module is not registered at
all, so there is no broken entry in the wallet list; set it and the QR option
appears with no code change. `allowedChains` is derived from `activeNetwork`
rather than left on the kit's PUBLIC default, which would have asked a testnet
deployment's wallet to approve a mainnet session.

**Still needs a human:** connect + issue + claim from a real phone with a real
wallet app, against a deployment that has the project id set. The QR handshake
and the wallet app's own `stellar_signMessage` support cannot be emulated.

### Adding a wallet

See [Adding a wallet](../../docs/architecture.md#adding-a-wallet) in the
architecture doc — in particular step 3: check the kit's module source for
`signMessage` before assuming it works, because every module *declares* it and
two of them throw.


### Evidence required before closing issues 2 and 3

Record at least three real-wallet issue-and-verify cycles, including Freighter.
For each record: date, deployed revision, wallet/version, browser/OS, network,
issuer address, authorization/issue/batch/revoke transaction hashes, token ids,
public verification URL/results before and after revocation, and claim result
(or the documented capability rejection). Check reload without a popup, changed
account, revoked permissions and cancellation. Inspect console CSP violations.
Do not check a matrix cell based only on an adapter mock or fake-ledger test.

WalletConnect additionally needs a configured Reown project and a real wallet
app. No live-wallet transaction evidence has been produced in this environment.
