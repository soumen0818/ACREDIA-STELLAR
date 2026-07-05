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
git clone https://github.com/Soumen1080/ACREDIA-STELLAR.git
cd ACREDIA-STELLAR\frontend
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Fill `frontend\.env.local` before testing flows that use Supabase, Pinata/IPFS, Stellar, or admin APIs. The canonical variable names live in `frontend/.env.local.example`.

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

- Keep `SUPABASE_SERVICE_ROLE_KEY`, `PINATA_JWT`, and Stellar secret keys server-only.
- Do not put secrets in `NEXT_PUBLIC_*` variables.
- Do not paste real secrets into screenshots, logs, browser code, pull requests, or issues.
- Verify contract IDs on Stellar Expert before using them in production.
- Use Stellar Public Network only after contract review, RLS review, and deployment verification.

## Reporting Issues

Use the GitHub issue templates. Reports should include:

- Required labels or area selection, such as `bug`, `setup`, `docs`, `frontend`, `contracts`, `database`, or `ci`.
- Exact affected file paths, for example `frontend/src/lib/contracts.ts` or `contracts/src/lib.rs`.
- Clean-clone setup commands copied from the README or this file.
- Environment details: OS, Node version, npm version, browser, wallet, and Stellar network.
- Expected behavior, actual behavior, and the smallest reproduction steps.

Issues missing setup steps, labels/area, or file paths may be closed until enough detail is provided.

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
