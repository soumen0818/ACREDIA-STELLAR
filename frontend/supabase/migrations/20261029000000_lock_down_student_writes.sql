-- =====================================================================
-- ACREDIA-STELLAR — LOCK DOWN DIRECT WRITES TO STUDENTS (IDEMPOTENT)
-- Codebase review 2026-10-29, §3.2 (docs/reviews/2026-10-29-codebase-review.md)
-- =====================================================================
-- The problem:
--   Four RLS policies let signed-in users write `public.students` directly
--   with the anon key, on any column:
--
--     "Students can update own data"          (UPDATE, the student's own row)
--     "Institutions can insert own students"  (INSERT, issuer-role members)
--     "Institutions can update own students"  (UPDATE, issuer-role members)
--     "Admin can update students"             (UPDATE, admins)
--
--   Reproduced against this schema on Postgres 16:
--     - a deactivated student set their own status back to 'active', moved
--       themselves into another institution's roster, and set
--       `wallet_address` to an address they do not own. Issuance links
--       credentials to students by `wallet_address`, so the last one makes
--       another student's future credentials appear in their dashboard;
--     - an issuer-role staff member set an unclaimed student's
--       `auth_user_id` to their own login, taking over that student's
--       identity, and inserted student rows with no validation and no
--       audit log entry.
--
-- Why removing them breaks nothing:
--   No application path writes `students` through the `authenticated` role.
--   Every legitimate write goes through a server route using the service
--   role, which bypasses RLS and keeps its privileges:
--     /api/institution/students            (provision, with audit log)
--     /api/institution/students/[id]       (correct / deactivate)
--     /api/institution/students/[id]/invite
--     /api/student/provision               (link account to roster row)
--     /api/claim/verify                    (wallet-ownership claim)
--     /api/account/erase  -> process_erasure() (SECURITY DEFINER)
--   The only `authenticated` writes were a silent client-side wallet
--   overwrite in StudentCredentialsList and the unused dbHelpers in
--   src/lib/supabase.ts; both are removed separately (review §3.3).
--
-- What this file does:
--   1. Drops the four direct-write policies. SELECT policies are unchanged:
--      a student still reads their own row, an institution still reads its
--      own roster, an admin still reads all.
--   2. Revokes INSERT, UPDATE, DELETE and TRUNCATE on `public.students` from
--      `anon` and `authenticated` (defense in depth). Supabase grants these
--      by default and relies on RLS alone; revoking them means a future
--      write policy added by mistake still cannot open direct writes.
--      TRUNCATE is included because it bypasses RLS entirely.
--
-- If a future feature genuinely needs a direct client write, add it as a
-- server route instead. If that is truly impossible, GRANT only the specific
-- columns it needs and add a narrowly scoped policy, with tests in
-- tests/rls/.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "Students can update own data" ON public.students;
DROP POLICY IF EXISTS "Institutions can insert own students" ON public.students;
DROP POLICY IF EXISTS "Institutions can update own students" ON public.students;
DROP POLICY IF EXISTS "Admin can update students" ON public.students;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.students FROM anon, authenticated;

COMMENT ON TABLE public.students IS
    'Student roster. Read via RLS (own row / own institution / admin); '
    'written only by service-role server routes. Direct writes from anon and '
    'authenticated are revoked (migration 20261029000000).';

COMMIT;
