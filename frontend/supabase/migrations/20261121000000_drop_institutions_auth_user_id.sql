-- =====================================================================
-- ACREDIA-STELLAR — DROP institutions.auth_user_id (Issue #308)
-- =====================================================================
-- Prerequisites:
--   - 20260808000000_institution_membership.sql has run (every institution
--     now has at least one row in public.institution_users).
--   - The backfill query below must return zero rows in production before
--     this migration is applied. Run it and paste the result in the issue:
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
