-- =====================================================================
-- ACREDIA-STELLAR — LOCK DOWN FUNCTION EXECUTE PRIVILEGES (IDEMPOTENT)
-- Codebase review 2026-10-29, §3.9 (docs/reviews/2026-10-29-codebase-review.md)
-- =====================================================================
-- The problem:
--   Supabase grants EXECUTE on every new function in `public` to `anon` and
--   `authenticated` (and Postgres grants it to PUBLIC). Earlier migrations
--   ran only `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, which leaves those
--   per-role grants in place. So anyone, even logged out, could call these
--   SECURITY DEFINER functions through POST /rest/v1/rpc/<name>:
--
--     next_job(text, text)           reproduced: an anonymous caller received a
--                                    queued email job (student email, name,
--                                    institution) and left it 'processing', so
--                                    the real worker never sent the email
--     process_erasure(uuid)          erasure, meant for the service role only
--     run_retention_purge()          retention purge, meant for cron only
--     purge_old_verification_logs()  "
--     purge_old_contact_messages()   "
--     retention_status()             admin-only operational counts
--     request_erasure()              unused by the app; erasure goes through
--                                    /api/account/erase only
--
--   Separately, the RLS policy helpers user_institution_ids(p_user_id) and
--   user_issuer_institution_ids(p_user_id) accepted any user id, so anyone
--   could look up another user's institution memberships by UUID.
--
-- What this file does:
--   1. The two membership helpers answer only for the caller's own account
--      (auth.uid()). An explicit other user id returns nothing unless the
--      caller is the service role or a direct database session (no JWT:
--      migrations, pg_cron, the SQL editor). Policies call them with no
--      argument, so policy behaviour is unchanged.
--   2. Revokes EXECUTE on the seven functions above from PUBLIC, anon and
--      authenticated, and grants it explicitly to service_role. Every real
--      caller uses the service role, and pg_cron runs as the owner.
--   3. Grants EXECUTE explicitly to anon and authenticated on the three
--      functions RLS policies call: is_admin(), user_institution_ids(uuid),
--      user_issuer_institution_ids(uuid). Policies are evaluated with the
--      querying user's privileges; without EXECUTE every query on the 15
--      tables they protect fails with "permission denied for function".
--      These grants must never be removed.
--   4. Stops new functions from being executable by clients by default:
--      functions created by this role (postgres: migrations and the SQL
--      editor) no longer get EXECUTE for PUBLIC, anon or authenticated.
--      service_role keeps its default.
--
-- For future migrations:
--   A new function that clients call through /rest/v1/rpc, or that an RLS
--   policy calls, needs an explicit
--       GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon, authenticated;
--   and an entry in the allowlist in tests/rls/functions.rls.test.ts, with
--   the reason. Trigger functions need nothing: Postgres never lets them be
--   called directly, and they fire regardless of the firing user's EXECUTE.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Membership helpers answer only for the caller
-- ---------------------------------------------------------------------
-- Same signature, filters and SECURITY DEFINER as before (see
-- 20260808000000_institution_membership.sql); only the caller check is new.
CREATE OR REPLACE FUNCTION public.user_institution_ids(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
    SELECT institution_id
    FROM public.institution_users
    WHERE auth_user_id = p_user_id
      AND status = 'active'
      AND (
          p_user_id IS NOT DISTINCT FROM auth.uid()
          OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          OR nullif(current_setting('request.jwt.claims', true), '') IS NULL
      );
$$;

COMMENT ON FUNCTION public.user_institution_ids(UUID) IS
    'Institutions the caller is an active member of. The single source of truth for institution ownership in RLS policies. '
    'Another user''s id returns nothing unless called by the service role or a direct database session.';

CREATE OR REPLACE FUNCTION public.user_issuer_institution_ids(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
    SELECT institution_id
    FROM public.institution_users
    WHERE auth_user_id = p_user_id
      AND status = 'active'
      AND role IN ('owner', 'issuer', 'admin', 'poc')
      AND (
          p_user_id IS NOT DISTINCT FROM auth.uid()
          OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          OR nullif(current_setting('request.jwt.claims', true), '') IS NULL
      );
$$;

COMMENT ON FUNCTION public.user_issuer_institution_ids(UUID) IS
    'Institutions the caller may write to. Excludes viewer/member, which are read-only. '
    'Another user''s id returns nothing unless called by the service role or a direct database session.';

-- ---------------------------------------------------------------------
-- 2. Internal functions: service role only
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
    public.next_job(text, text),
    public.process_erasure(uuid),
    public.run_retention_purge(),
    public.purge_old_verification_logs(),
    public.purge_old_contact_messages(),
    public.retention_status(),
    public.request_erasure()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.next_job(text, text),
    public.process_erasure(uuid),
    public.run_retention_purge(),
    public.purge_old_verification_logs(),
    public.purge_old_contact_messages(),
    public.retention_status(),
    public.request_erasure()
TO service_role;

-- ---------------------------------------------------------------------
-- 3. Functions RLS policies call: every role that queries must keep them
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
    public.is_admin(),
    public.user_institution_ids(uuid),
    public.user_issuer_institution_ids(uuid)
TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. New functions are not client-executable by default
-- ---------------------------------------------------------------------
-- Supabase's per-schema default for functions created by this role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- Postgres's built-in PUBLIC default can only be revoked globally (not per
-- schema). anon and authenticated are members of PUBLIC, so without this the
-- line above would have no effect.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
