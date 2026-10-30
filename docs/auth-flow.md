# Authentication & Role Resolution — Contributor Guide

> **Audience:** Developers contributing to the ACREDIA-STELLAR frontend.
> This document explains how authentication and role-based access control work
> end-to-end so you never have to guess which function to call.

---

## 1. Architecture Overview

ACREDIA-STELLAR is a **Next.js** application that uses **Supabase Auth** for
identity management and the **Stellar blockchain** for credential issuance and
verification. The auth system is split into three layers:

```
┌──────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
│                                                      │
│  AuthContext.tsx  ──▶  useAuth()  ──▶  Components    │
│        │                                             │
│        ▼                                             │
│  roleResolver.ts  (resolveUserRoleClient)            │
└──────────────────────────────────────────────────────┘
                         │
                    Supabase API
                         │
┌──────────────────────────────────────────────────────┐
│                   Server (API Routes)                │
│                                                      │
│  serverAuth.ts  ──▶  requireAuthenticatedRequest()   │
│                 ──▶  requireInstitutionRequest()      │
│                 ──▶  requireAdminRequest()            │
│                                                      │
│  roleResolver.ts  (resolveUserRoleServer)            │
└──────────────────────────────────────────────────────┘
```

| Concern                    | Module                         |
| -------------------------- | ------------------------------ |
| Auth state & React context | `src/contexts/AuthContext.tsx` |
| Shared role resolution     | `src/lib/roleResolver.ts`      |
| Server-side route guards   | `src/lib/serverAuth.ts`        |
| Admin hardening            | `src/lib/adminAccess.ts`       |
| Supabase client & helpers  | `src/lib/supabase.ts`          |
| Type definitions           | `src/types/index.ts`           |

---

## 2. Role Types

Defined in [`src/types/index.ts`](src/types/index.ts):

```ts
/** All possible application roles. */
export type AppRole = 'student' | 'institution' | 'admin';

/**
 * Role states used by the auth system, including transient states.
 * - 'loading': role resolution is in progress (initial render)
 * - 'unknown': role could not be determined (no DB rows, no metadata)
 */
export type RoleState = AppRole | 'unknown' | 'loading';
```

> [!NOTE]
> The legacy type alias `UserRole` still exists for backward compatibility but
> is deprecated. Always use `AppRole` in new code.

---

## 3. Role Resolution Priority

Role resolution is centralized in
[`src/lib/roleResolver.ts`](src/lib/roleResolver.ts). The `resolveUserRole()`
function checks the following sources **in order** and stops at the first match:

```
Priority  Source                  Description
────────  ──────────────────────  ───────────────────────────────────────────
  1       profiles.role           DB-backed source of truth (set by trusted
                                  backend processes). Validated against the
                                  set {'admin', 'institution', 'student'}.

  2       institutions table      Row exists with matching auth_user_id
                                  → returns 'institution'.

  3       students table          Row exists with matching auth_user_id
                                  → returns 'student'.

  4       (default)               → returns 'unprovisioned' for a signed-in
                                  user with no role rows, 'unknown' when
                                  there is no user at all.
```

> [!IMPORTANT]
> `profiles.role` is the **only** trusted source for the `'admin'` role.
> All other paths explicitly strip or ignore admin claims.

### How it works under the hood

```ts
// Simplified from src/lib/roleResolver.ts

export async function resolveUserRole(
    client: SupabaseClient,
    user: User | null,
): Promise<AppRole | 'unknown'> {
    if (!user) return 'unknown';

    // 1. Profiles table
    const profileRole = await resolveFromProfiles(client, user.id);
    if (profileRole) return profileRole;

    // 2. Institutions table
    if (await hasRowIn(client, 'institutions', user.id)) return 'institution';

    // 3. Students table
    if (await hasRowIn(client, 'students', user.id)) return 'student';

    // 4. Nothing matched — the account exists but was never provisioned
    return 'unprovisioned';
}
```

Two convenience wrappers exist so callers don't need to worry about client
construction:

| Wrapper                                 | Used by           | Notes                                                          |
| --------------------------------------- | ----------------- | -------------------------------------------------------------- |
| `resolveUserRoleClient(client, user)`   | `AuthContext.tsx` | Thin pass-through to `resolveUserRole`                         |
| `resolveUserRoleServer(client, userId)` | API routes        | Fetches the `User` object via `auth.admin.getUserById()` first |

---

## 4. Client-Side Usage

### The `useAuth()` hook

All client components access auth state through a single hook exported from
[`src/contexts/AuthContext.tsx`](src/contexts/AuthContext.tsx):

```tsx
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
    const { user, userRole, loading, signOut } = useAuth();

    if (loading) return <Spinner />;
    if (!user) return <LoginPrompt />;

    return <p>Your role is: {userRole}</p>;
}
```

The `AuthProvider` (which wraps the app) handles:

1. Fetching the initial session via `safeGetSession()`.
2. Listening for `onAuthStateChange` events (login, logout, token refresh).
3. Calling `resolveUserRoleClient()` whenever the user changes.
4. Exposing the resolved `userRole` as a `RoleState`.

> [!CAUTION]
> **NEVER** import from `@/hooks/useAuth` — that module has been deleted.
> The canonical hook lives in `@/contexts/AuthContext`.

> [!WARNING]
> **NEVER** read `session.user.user_metadata?.role` directly in components.
> That value is user-controlled signup data and may contain `'admin'` or other
> garbage. Always rely on `userRole` from `useAuth()`.

### Checking `loading` before acting on roles

```tsx
const { userRole, loading } = useAuth();

// ❌ Bad — userRole is 'loading' on first render
if (userRole === 'admin') {
    /* ... */
}

// ✅ Good — wait for resolution to finish
if (!loading && userRole === 'admin') {
    /* ... */
}
```

---

## 5. Protected Routes

The `ProtectedRoute` component (also exported from `AuthContext.tsx`) handles
redirect logic for role-gated pages:

```tsx
import { ProtectedRoute } from '@/contexts/AuthContext';

// Only admins can see this page
<ProtectedRoute allowedRoles={['admin']}>
    <AdminDashboard />
</ProtectedRoute>

// Any authenticated user (omit allowedRoles)
<ProtectedRoute>
    <ProfilePage />
</ProtectedRoute>

// Students and institutions
<ProtectedRoute allowedRoles={['student', 'institution']}>
    <CredentialViewer />
</ProtectedRoute>
```

**Behavior:**

| Condition                         | Action                                   |
| --------------------------------- | ---------------------------------------- |
| `loading === true`                | Renders a full-screen "Loading…" spinner |
| No authenticated user             | Redirects to `/auth/login`               |
| User's role not in `allowedRoles` | Redirects to `/dashboard`                |
| Authorized                        | Renders `children`                       |

---

## 6. Server-Side API Route Protection

Server-side guards live in
[`src/lib/serverAuth.ts`](src/lib/serverAuth.ts). They validate the `Bearer`
token from the `Authorization` header and return a discriminated union:

```ts
type AuthResult =
    | { ok: true; userId: string; user: User; accessToken: string }
    | { ok: false; status: number; error: string };
```

`user` and `accessToken` are carried through so role-checking guards can reuse
the verified user without a second round-trip, and can build a token-scoped
client when no service-role key is configured. Guards that layer on top of
`requireAuthenticatedRequest` (below) narrow this to their own shape.

### `requireAuthenticatedRequest(request)`

Use for any endpoint that requires a logged-in user:

```ts
import { requireAuthenticatedRequest } from '@/lib/serverAuth';

export async function GET(request: NextRequest) {
    const auth = await requireAuthenticatedRequest(request);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // auth.userId is now available
    const data = await fetchDataFor(auth.userId);
    return NextResponse.json(data);
}
```

### `requireAdminRequest(request)`

Use for admin-only endpoints. This performs **two** checks beyond basic auth:

1. **Email allowlist** — the user's email must appear in the
   `ADMIN_EMAIL_ALLOWLIST` environment variable (comma-separated).
2. **Profile role** — `profiles.role` must be `'admin'`.

Both must pass. This prevents privilege escalation even if one layer is
misconfigured.

```ts
import { requireAdminRequest } from '@/lib/serverAuth';

export async function POST(request: NextRequest) {
    const auth = await requireAdminRequest(request);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Caller is a verified admin
    await performAdminAction(auth.userId);
    return NextResponse.json({ success: true });
}
```

### `requireInstitutionRequest(request)`

Use for endpoints only credential **issuers** may call — anything that spends a
shared, server-held resource on the caller's behalf (for example the
credential document upload route, which writes to private Storage with the
service-role key).

It authenticates the caller, then resolves their role through the shared
[`resolveUserRole()`](src/lib/roleResolver.ts) resolver, so it can never drift
from the priority table in §3. Anything other than `'institution'` — anonymous
(401), student, admin, or unprovisioned (403) — is rejected. Admins are **not**
issuers and are rejected too.

```ts
import { requireInstitutionRequest } from '@/lib/serverAuth';

export async function POST(request: NextRequest) {
    const auth = await requireInstitutionRequest(request);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // auth.userId is a verified institution; auth.institutionId scopes the work
    // (null when the role came from `profiles.role` with no `institutions` row).
}
```

> [!IMPORTANT]
> Pair this guard with a **per-user** quota, not just a per-IP one. Pass
> `identifier: auth.userId` to `enforceRateLimit()` so a single account cannot
> sidestep its quota by rotating source addresses. See `POST /api/institution/documents` for the
> pattern: a coarse per-IP limit *before* the auth check (so anonymous floods
> cannot drive token verification), then a per-account quota after it.

### `resolveUserRoleServer(client, userId)`

When you need the user's resolved role inside a server context (but aren't
necessarily guarding the entire route):

```ts
import { resolveUserRoleServer } from '@/lib/roleResolver';
import { getServiceRoleClient } from '@/lib/serverAuth';

const client = getServiceRoleClient();
const role = await resolveUserRoleServer(client, userId);
```

---

## 7. Admin Provisioning

> [!CAUTION]
> Admin accounts can **NEVER** be self-created. Since Issue #239 removed public
> signup there is no client path that creates an account of any kind, and
> `profiles.role` — writable only by trusted server-side processes — is the sole
> source of the `'admin'` role.

### Why there is no signup role to normalize

Acredia used to accept a self-asserted `role` in signup metadata and clamp it
with `normalizePublicSignupRole()`, so a stranger could never claim `'admin'`.
Public signup is gone, so both the claim and the clamp are gone with it:

- `/auth/register` no longer exists (stale links redirect to `/contact`).
- `signUp()` has been removed from `src/lib/supabase.ts`.
- The signup mirror triggers that created rows from auth metadata are dropped.

A role is now set only by whoever provisioned the account: an Acredia admin for
institutions, an institution for its students.

### To provision a new admin

Follow these steps **exactly**:

1. **Create the user** — normal signup through Supabase Auth (or the Supabase
   Dashboard). The user will initially be assigned `'student'` or
   `'institution'`.

2. **Set the profile role** — update the `profiles` table directly:

    ```sql
    UPDATE profiles SET role = 'admin' WHERE id = '<user-uuid>';
    ```

3. **Add to email allowlist** — append the user's email to the
   `ADMIN_EMAIL_ALLOWLIST` environment variable:

    ```env
    ADMIN_EMAIL_ALLOWLIST=alice@example.com,bob@example.com
    ```

4. **Redeploy** — the env var change must be picked up by the server.

> [!IMPORTANT]
> **Both** the profile role **and** the email allowlist must match for
> `requireAdminRequest()` to succeed. Setting only one is not sufficient.

---

## 8. Common Pitfalls

> [!WARNING]
> These are the most frequent mistakes made by new contributors. Read carefully.

### ❌ Trusting `user_metadata.role`

```ts
// WRONG — this is user-controlled data set during signup
const role = session.user.user_metadata?.role;
if (role === 'admin') grantAdminAccess(); // 🚨 Security hole

// RIGHT — use the resolved role
const { userRole } = useAuth();
if (!loading && userRole === 'admin') grantAdminAccess();
```

### ❌ Creating separate auth hooks

```ts
// WRONG — don't create new hooks for auth state
export function useCurrentRole() {
    const { data } = useSWR('/api/me', fetcher);
    return data?.role;
}

// RIGHT — use the centralized hook
const { userRole } = useAuth();
```

### ❌ Checking roles differently on client vs. server

Both sides share `resolveUserRole()` from `roleResolver.ts`. If you find
yourself writing custom role-checking logic, you're probably duplicating
something that already exists.

### ❌ Forgetting to check `loading`

```tsx
// WRONG — on first render, userRole is 'loading'
if (userRole !== 'admin') return <AccessDenied />;

// RIGHT — wait for resolution
if (loading) return <Spinner />;
if (userRole !== 'admin') return <AccessDenied />;
```

### ❌ Using `getSession()` instead of `safeGetSession()`

The `safeGetSession()` wrapper in `src/lib/supabase.ts` handles invalid refresh
tokens and proactive session renewal. Always prefer it over the raw Supabase
`getSession()`.

---

## 9. File Map

| File                                                           | Purpose                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`src/types/index.ts`](src/types/index.ts)                     | `AppRole`, `RoleState` type definitions                                                                |
| [`src/lib/roleResolver.ts`](src/lib/roleResolver.ts)           | Shared role resolution logic (`resolveUserRole`, `resolveUserRoleClient`, `resolveUserRoleServer`)     |
| [`src/contexts/AuthContext.tsx`](src/contexts/AuthContext.tsx) | Client-side auth state provider (`AuthProvider`, `useAuth`, `ProtectedRoute`)                          |
| [`src/lib/serverAuth.ts`](src/lib/serverAuth.ts)               | Server-side auth guards (`requireAuthenticatedRequest`, `requireInstitutionRequest`, `requireAdminRequest`, `getServiceRoleClient`) |
| [`src/lib/adminAccess.ts`](src/lib/adminAccess.ts)             | Admin setup helpers                                                                                    |
| [`src/lib/supabase.ts`](src/lib/supabase.ts)                   | Supabase browser client, `signIn`, `signOut`, `safeGetSession` (no `signUp` — provisioning is closed)   |

---

## 10. Quick-Reference Cheat Sheet

```
CLIENT COMPONENT          SERVER API ROUTE
──────────────────        ──────────────────────────────────────
import { useAuth }        import { requireAuthenticatedRequest,
  from                              requireAdminRequest }
  '@/contexts/AuthContext'   from '@/lib/serverAuth';

const { user,             const auth = await requireAuthenticatedRequest(req);
        userRole,         if (!auth.ok) return error response;
        loading,
        signOut           // Need the role?
      } = useAuth();      import { resolveUserRoleServer }
                            from '@/lib/roleResolver';
                          const role = await resolveUserRoleServer(client, auth.userId);
```
