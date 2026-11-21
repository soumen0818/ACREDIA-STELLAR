-- =====================================================================
-- ACREDIA-STELLAR — DROP institutions.auth_user_id (Issue #308)
-- =====================================================================
-- Prerequisites:
--   - 20260808000000_institution_membership.sql has run (every institution
--     now has at least one row in public.institution_users).
--   - Advisory: the query below lists institutions whose recorded login has
--     no matching membership. It is worth running and recording in the issue
--     before applying, but no longer required: the migration itself backfills
--     the users the old fallback admitted (see the DO block below).
--
--     SELECT i.id, i.name
--     FROM public.institutions i
--     WHERE i.auth_user_id IS NOT NULL
--       AND NOT EXISTS (
--         SELECT 1
--         FROM public.institution_users iu
--         WHERE iu.institution_id = i.id
--           AND iu.auth_user_id = i.auth_user_id
--           AND iu.removed_at IS NULL
--       );
--
-- What this file does:
--   1. Drops the deprecated `institutions.auth_user_id` column now that all
--      application code routes membership through `institution_users`.
--
-- NOTE: `students.auth_user_id` is a completely different column on a
--       completely different table and is intentionally NOT touched here.
-- =====================================================================

BEGIN;

-- Self-protecting backfill: do not rely on the manual check above having been
-- run. Until #308 the app let a user act as owner through this column when they
-- had no membership row at all (in any status, at any institution). Give
-- exactly those users the membership that access becomes, so dropping the
-- column locks nobody out. A user with any membership row — including a
-- removed (`deactivated`) one — was already refused by the old fallback, and
-- is not given access back here. Guarded so re-applying schema.sql after the
-- column is gone is a no-op.
DO $backfill$
DECLARE
    v_backfilled INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
    ) THEN
        INSERT INTO public.institution_users (institution_id, auth_user_id, role, status, is_active)
        SELECT i.id, i.auth_user_id, 'owner', 'active', true
        FROM public.institutions i
        WHERE i.auth_user_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.institution_users iu
              WHERE iu.auth_user_id = i.auth_user_id
          )
        ON CONFLICT (institution_id, auth_user_id) DO NOTHING;

        GET DIAGNOSTICS v_backfilled = ROW_COUNT;
        IF v_backfilled > 0 THEN
            RAISE NOTICE '#308: backfilled % owner membership(s) from institutions.auth_user_id before dropping it', v_backfilled;
        END IF;
    END IF;
END
$backfill$;

-- Drop the foreign key constraint first (it was changed to ON DELETE SET NULL
-- in 20260808000000_institution_membership.sql, but must be removed before
-- the column itself can be dropped).
ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_auth_user_id_fkey;

-- Drop the deprecated single-login column.
-- All memberships are now expressed through public.institution_users.
-- students.auth_user_id is a separate column on a separate table and is kept.
ALTER TABLE public.institutions
    DROP COLUMN IF EXISTS auth_user_id;

COMMENT ON TABLE public.institutions IS
    'Registered issuing institutions. Membership is expressed through '
    'public.institution_users; the deprecated single-login auth_user_id column '
    'was removed in Issue #308.';

COMMIT;
