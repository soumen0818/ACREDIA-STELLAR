-- =====================================================================
-- ACREDIA-STELLAR — ONE LOGIN PER INSTITUTION -> MEMBERSHIP (IDEMPOTENT)
-- Issue #238: Replace institutions.auth_user_id with a membership table
-- =====================================================================
-- What this file does:
--   1. Evolves `public.institution_users` (introduced for POC handover) into
--      the general membership relation: adds `status` and `invited_by`, and
--      widens the role vocabulary to owner/issuer/viewer.
--   2. Backfills a membership row for every institution that still only has
--      `institutions.auth_user_id`, so no institution loses access.
--   3. Rewrites every institution-scoped RLS policy to check membership
--      instead of the single-owner column.
--   4. Deprecates `institutions.auth_user_id` — kept nullable and unused so
--      this migration stays reversible. A later migration drops it.
--
-- Behaviour is intentionally unchanged on delivery: each institution ends up
-- with exactly one active `owner`, which is what the old column expressed.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 0. The membership table, for databases that never ran the POC-handover
--    migration. Where it already exists this is a no-op and step 1 evolves
--    it in place.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institution_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id  UUID NOT NULL REFERENCES public.institutions (id) ON DELETE CASCADE,
    auth_user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'issuer',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, auth_user_id)
);

-- ---------------------------------------------------------------------
-- 1. Membership lifecycle columns
-- ---------------------------------------------------------------------
ALTER TABLE public.institution_users
    ADD COLUMN IF NOT EXISTS status     TEXT,
    ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users (id) ON DELETE SET NULL;

-- `is_active` predates `status`. Derive the richer column from it so existing
-- rows carry a correct lifecycle value, then make it authoritative.
UPDATE public.institution_users
SET status = CASE WHEN is_active THEN 'active' ELSE 'deactivated' END
WHERE status IS NULL;

ALTER TABLE public.institution_users
    ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE public.institution_users
    ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.institution_users
    DROP CONSTRAINT IF EXISTS institution_users_status_check;

ALTER TABLE public.institution_users
    ADD CONSTRAINT institution_users_status_check
    CHECK (status IN ('invited', 'active', 'deactivated'));

-- Role vocabulary. `owner`/`issuer`/`viewer` are the roles this issue defines;
-- `admin`/`member`/`poc` are retained because the POC-handover and
-- provisioning routes already write them, and rewriting those call sites is
-- not what this structural change is for.
ALTER TABLE public.institution_users
    DROP CONSTRAINT IF EXISTS institution_users_role_check;

ALTER TABLE public.institution_users
    ADD CONSTRAINT institution_users_role_check
    CHECK (role IN ('owner', 'issuer', 'viewer', 'admin', 'member', 'poc'));

COMMENT ON TABLE public.institution_users IS
    'Membership relation binding auth users to institutions. Replaces the single-login institutions.auth_user_id column: an institution may have many members, and removing a member never removes the institution.';

COMMENT ON COLUMN public.institution_users.role IS
    'owner may manage members; issuer may issue and revoke credentials; viewer is read-only. Legacy poc/admin/member values map onto owner/issuer/viewer respectively.';

COMMENT ON COLUMN public.institution_users.status IS
    'invited = provisioned but has not accepted; active = may act; deactivated = retained for audit but denied access.';

-- `is_active` is kept in lockstep so the POC-handover routes, which still
-- write and read it, cannot disagree with `status` about who has access.
UPDATE public.institution_users
SET is_active = (status = 'active')
WHERE is_active <> (status = 'active');

CREATE OR REPLACE FUNCTION public.sync_institution_user_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- Whichever column the caller set, make the other agree. `status` wins
    -- when both changed, since it is the more expressive of the two.
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'active' THEN
            NEW.is_active := (NEW.status = 'active');
        ELSE
            NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'deactivated' END;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.is_active := (NEW.status = 'active');
    ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'deactivated' END;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_institution_user_status ON public.institution_users;
CREATE TRIGGER trg_sync_institution_user_status
    BEFORE INSERT OR UPDATE ON public.institution_users
    FOR EACH ROW EXECUTE FUNCTION public.sync_institution_user_status();

CREATE INDEX IF NOT EXISTS idx_institution_users_active_membership
    ON public.institution_users (auth_user_id, institution_id)
    WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 2. Backfill — every institution keeps access
-- ---------------------------------------------------------------------
-- Institutions whose owner was only ever recorded in the deprecated column.
-- Re-run safety (#308): only while institutions.auth_user_id exists. On a
-- fresh install it always does here; after the column is dropped, re-applying
-- schema.sql skips this legacy block (a later migration supersedes it).
DO $guard$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
) THEN
INSERT INTO public.institution_users (institution_id, auth_user_id, role, status, is_active)
SELECT id, auth_user_id, 'owner', 'active', true
FROM public.institutions
WHERE auth_user_id IS NOT NULL
ON CONFLICT (institution_id, auth_user_id) DO NOTHING;

-- The POC-handover migration backfilled with role 'poc'. That is the same
-- relationship this issue calls 'owner', so normalise it — otherwise an
-- institution would have no owner and nobody could manage members.
UPDATE public.institution_users iu
SET role = 'owner'
WHERE iu.role = 'poc'
  AND EXISTS (
      SELECT 1 FROM public.institutions i
      WHERE i.id = iu.institution_id
        AND i.auth_user_id = iu.auth_user_id
  );
END IF;
END
$guard$;


-- ---------------------------------------------------------------------
-- 3. Membership helpers used by the policies below
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so the lookup does not itself recurse through the
-- institution_users policies while those policies are being evaluated.
CREATE OR REPLACE FUNCTION public.user_institution_ids(p_user_id UUID DEFAULT auth.uid())
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
    SELECT institution_id
    FROM public.institution_users
    WHERE auth_user_id = p_user_id
      AND status = 'active';
$$;

COMMENT ON FUNCTION public.user_institution_ids(UUID) IS
    'Institutions the given user is an active member of. The single source of truth for institution ownership in RLS policies.';

-- Issuance requires a role that may write, not merely membership.
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
      AND role IN ('owner', 'issuer', 'admin', 'poc');
$$;

COMMENT ON FUNCTION public.user_issuer_institution_ids(UUID) IS
    'Institutions the user may write to. Excludes viewer/member, which are read-only.';

-- ---------------------------------------------------------------------
-- 4. RLS policies — membership instead of the single-owner column
-- ---------------------------------------------------------------------

-- Institutions ------------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view own data" ON public.institutions;
CREATE POLICY "Institutions can view own data"
  ON public.institutions FOR SELECT
  USING (id IN (SELECT public.user_institution_ids()));

DROP POLICY IF EXISTS "Institutions can update own data" ON public.institutions;
CREATE POLICY "Institutions can update own data"
  ON public.institutions FOR UPDATE
  USING (id IN (SELECT public.user_issuer_institution_ids()))
  WITH CHECK (id IN (SELECT public.user_issuer_institution_ids()));

-- Institutions are provisioned by admins, never self-inserted. The old
-- "Institutions can insert own data" policy existed for the removed signup
-- flow and has no membership equivalent: a row cannot be a member of itself
-- before it exists.
DROP POLICY IF EXISTS "Institutions can insert own data" ON public.institutions;

-- Credentials -------------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view issued credentials" ON public.credentials;
CREATE POLICY "Institutions can view issued credentials"
  ON public.credentials FOR SELECT
  USING (institution_id IN (SELECT public.user_institution_ids()));

DROP POLICY IF EXISTS "Institutions can insert credentials" ON public.credentials;
CREATE POLICY "Institutions can insert credentials"
  ON public.credentials FOR INSERT
  WITH CHECK (
    institution_id IN (
      SELECT i.id FROM public.institutions i
      WHERE i.verified = true
        AND i.id IN (SELECT public.user_issuer_institution_ids())
    )
  );

DROP POLICY IF EXISTS "Institutions can update own credentials" ON public.credentials;
CREATE POLICY "Institutions can update own credentials"
  ON public.credentials FOR UPDATE
  USING (
    institution_id IN (
      SELECT i.id FROM public.institutions i
      WHERE i.verified = true
        AND i.id IN (SELECT public.user_issuer_institution_ids())
    )
  )
  WITH CHECK (
    institution_id IN (
      SELECT i.id FROM public.institutions i
      WHERE i.verified = true
        AND i.id IN (SELECT public.user_issuer_institution_ids())
    )
  );

-- API keys ----------------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view own api keys" ON public.api_keys;
CREATE POLICY "Institutions can view own api keys"
  ON public.api_keys FOR SELECT
  USING (institution_id IN (SELECT public.user_institution_ids()));

DROP POLICY IF EXISTS "Institutions can insert own api keys" ON public.api_keys;
CREATE POLICY "Institutions can insert own api keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (institution_id IN (SELECT public.user_issuer_institution_ids()));

DROP POLICY IF EXISTS "Institutions can update own api keys" ON public.api_keys;
CREATE POLICY "Institutions can update own api keys"
  ON public.api_keys FOR UPDATE
  USING (institution_id IN (SELECT public.user_issuer_institution_ids()))
  WITH CHECK (institution_id IN (SELECT public.user_issuer_institution_ids()));

-- Credential pins ---------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view own credential pins" ON public.credential_pins;
CREATE POLICY "Institutions can view own credential pins"
    ON public.credential_pins FOR SELECT
    USING (
        credential_id IN (
            SELECT c.id FROM public.credentials c
            WHERE c.institution_id IN (SELECT public.user_institution_ids())
        )
    );

-- Institution users -------------------------------------------------------
-- Replaces the Issue 14 policy, which read the deprecated column directly.
DROP POLICY IF EXISTS "Institution members can view colleagues" ON public.institution_users;
CREATE POLICY "Institution members can view colleagues"
    ON public.institution_users FOR SELECT
    USING (institution_id IN (SELECT public.user_institution_ids()));

-- ---------------------------------------------------------------------
-- 5. Deprecate the single-login column
-- ---------------------------------------------------------------------
-- Kept, nullable and unused, so this migration can be rolled back. The
-- ON DELETE CASCADE is the dangerous part — deleting a departing member's
-- auth user would cascade away the whole institution — so that is dropped
-- now even though the column stays.
-- Re-run safety (#308): only while institutions.auth_user_id exists. On a
-- fresh install it always does here; after the column is dropped, re-applying
-- schema.sql skips this legacy block (a later migration supersedes it).
DO $guard$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
) THEN
ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_auth_user_id_fkey;

ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.institutions
    ALTER COLUMN auth_user_id DROP NOT NULL;

COMMENT ON COLUMN public.institutions.auth_user_id IS
    'DEPRECATED (Issue #238): superseded by public.institution_users. Retained nullable and unread so the membership migration stays reversible; a later migration drops it. Do not add new reads.';
END IF;
END
$guard$;


COMMIT;
