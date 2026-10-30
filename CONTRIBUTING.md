# Contributing to ACREDIA-STELLAR

Thank you for your interest in contributing to ACREDIA-STELLAR. Contributions are welcome, but please keep them focused, useful, and aligned with the project goals.

## Before You Start

Before opening a pull request, please:

- Check existing issues and pull requests to avoid duplicates.
- Open or comment on an issue first for major changes.
- Make sure the change solves a real problem in the project.
- Do not create unnecessary pull requests for very small, unrelated, or cosmetic-only changes.

Good contributions include:


- Security fixes
- Smart contract correctness fixes
- Verification flow improvements
- Authentication and authorization fixes
- Database/RLS improvements
- Bug fixes with clear reproduction steps
- Test coverage for important flows
- Documentation that helps users run or understand the project

Please avoid:

- Unnecessary formatting-only pull requests
- Random dependency changes without reason
- Large refactors without discussion
- Low-value typo-only PRs unless they fix important documentation
- Adding unrelated features without an issue

## Clean Clone Setup

Use npm for frontend work. The repository commits `frontend/package-lock.json`, and CI uses `npm ci`.

```powershell
git clone https://github.com/soumen0818/ACREDIA-STELLAR.git
cd ACREDIA-STELLAR\frontend
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Fill `frontend\.env.local` before testing flows that use Supabase, Stellar, or admin APIs. The canonical variable names live in `frontend/.env.local.example`.

For contract deployment work only:

```powershell
cd ..\contracts
Copy-Item .env.example .env
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

Run the canonical Supabase scripts for a clean database:

```text
frontend/sql/database_schema.sql
frontend/sql/secure_rls_migration.sql
```

## Production Safety

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `VERIFICATION_LOG_HASH_SECRET`, and Stellar secret keys server-only.
- Do not put secrets in `NEXT_PUBLIC_*` variables.
- Do not paste real secrets into screenshots, logs, browser code, pull requests, or issues.
- Verify contract IDs on Stellar Expert before using them in production.
- Use Stellar Public Network only after contract review, RLS review, and deployment verification.

## Secret Scan Gate (Pre-Commit + CI)

This repository uses `gitleaks` in CI and ships a local pre-commit hook config.

Set up the local hook once:

```powershell
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

If a secret is detected, rotate the affected key immediately and follow `SECRETS_ROTATION.md`.

## Reporting Issues

Use the GitHub issue templates. Reports should include:

- Required labels or area selection, such as `bug`, `setup`, `docs`, `frontend`, `contracts`, `database`, or `ci`.
- Exact affected file paths, for example `frontend/src/lib/contracts.ts` or `contracts/src/lib.rs`.
- Clean-clone setup commands copied from the README or this file.
- Environment details: OS, Node version, npm version, browser, wallet, and Stellar network.
- Expected behavior, actual behavior, and the smallest reproduction steps.

Issues missing setup steps, labels/area, or file paths may be closed until enough detail is provided.

## Engineering Standards

These are the parts of the codebase that are already done right. Every pull request is reviewed against them, and a PR that weakens one of them will be asked to change, even if its tests pass.

- **Verification trusts the chain, not the database.** Status checks (`frontend/src/app/api/verify/[token]/route.ts`) read existence, revocation, expiry and issuer authorization from the contract only (`frontend/src/lib/contractReads.ts` never touches the database). The share page (`frontend/src/lib/sharedCredential.ts`) re-hashes the stored credential against the on-chain `credential_hash` and displays only fields that hash covers. Do not add a code path where editing a database row can make a credential verify, un-revoke it, or change what it shows.
- **A token ID shows status only.** Who holds a credential and what it certifies are visible only through the holder's share link. Do not add holder data to `/api/verify` or to any page addressed by token ID.
- **Runtime config fails fast.** `frontend/src/lib/runtimeConfig.ts` refuses known testnet contract IDs on mainnet, requires an explicit network in production, and blocks secrets from `NEXT_PUBLIC_*`. New environment variables go through `runtimeConfig`, not raw `process.env` reads, and must keep these guarantees.
- **No hardcoded network values.** Explorer URLs, Horizon/RPC endpoints and passphrases come from `runtimeConfig.stellar` (for example `explorerBaseUrl`). Never write `testnet` or `public` into a URL in a component.
- **Contract governance stays intact.** Two-step ownership (`transfer_owner` → `accept_owner`), the timelocked upgrade (`propose_upgrade` → `upgrade`), `pause`, typed `ContractError` returns, the bounded `MAX_BATCH_SIZE`, and TTL management are deliberate. Changes to any of them need an issue, an explanation, and tests. Behaviour changes to `contracts/src/lib.rs` must add or update unit tests, and property tests where an invariant is involved.
- **Every API route is rate limited** with `enforceRateLimit` (`frontend/src/lib/rateLimit.ts`). Routes that send email or other costly side effects also get a per-user quota, not only a per-IP limit.
- **New and changed API routes validate their input** with a zod schema and return the `{ success, error }` envelope used across `frontend/src/app/api/`. Some older routes do not validate yet; if your PR touches one, add the schema.
- **The CSP stays strict.** Scripts are allowed by per-request nonce and `strict-dynamic`. Do not add `'unsafe-inline'` or `'unsafe-eval'` to `script-src` in production. New external origins go in `frontend/src/lib/securityHeaders.ts` only when the feature actually uses them, with the reason in the PR.
- **Wallet libraries stay behind the wallet boundary.** Only `frontend/src/lib/wallet/` may import a wallet library. Everything else uses the `WalletAdapter` from `@/lib/wallet`. ESLint enforces this; do not disable the rule.
- **Use design tokens, not raw colours.** Use the semantic utilities defined in `frontend/src/app/globals.css` (`bg-primary`, `text-success`, `border-warning`, …). Do not add Tailwind palette classes such as `bg-gray-50` or `text-amber-800`.
- **Record decisions and procedures.** A change to architecture, data retention, roles, or key custody gets an ADR in `docs/decisions/`. A change to how the system is operated updates the matching runbook in `docs/ops/`.
- **CI stays pinned and green.** GitHub Actions are pinned to full commit SHAs. Gitleaks, CodeQL, dependency review, `cargo audit` and `cargo deny` must pass; do not skip or weaken them.

## Pull Requests

Before opening a pull request:

- Keep the change scoped to the issue or documented problem.
- Add or update tests when changing behavior.
- Update README, env examples, SQL notes, or issue templates when setup behavior changes.
- **Responsive Design Checklist**:
  - Test UI changes at 320px, 375px, 768px, 1024px, and 1440px.
  - Ensure no horizontal scrolling occurs on mobile devices (e.g., test using browser dev tools).
  - Verify tap targets are at least 44x44px on mobile devices.
  - Ensure flex/grid layouts collapse properly on smaller screens.
  - Wrap data tables and long credential lists in `overflow-x-auto`.
- Run the relevant checks locally where possible:

```powershell
cd frontend
npm run format
npm run lint
npm test
npm run build
```

```powershell
cd contracts
cargo fmt -- --check
cargo test --lib
cargo build --target wasm32-unknown-unknown --release
```
