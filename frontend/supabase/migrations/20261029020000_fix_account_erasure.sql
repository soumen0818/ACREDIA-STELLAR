-- =====================================================================
-- ACREDIA-STELLAR — ACCOUNT ERASURE: ACCOUNT-ONLY, AND IT WORKS (IDEMPOTENT)
-- Codebase review 2026-10-29, §3.10 (docs/reviews/2026-10-29-codebase-review.md)
-- =====================================================================
-- The problems:
--   1. process_erasure() failed for every user. It set profiles.email,
--      students.email and institutions.email to NULL, but all three columns
--      are NOT NULL ("null value in column email violates not-null
--      constraint"). No account deletion has ever completed.
--   2. Had it worked, it would have done far more than users are told. The
--      Delete screen and the privacy policy say deletion removes the user's
--      account, profile and preferences, and that issued credentials are
--      retained. The function instead redacted the student's roster record
--      and credential metadata (so verification would report a hash
--      "mismatch", making a genuine degree look forged) and renamed the
--      user's institution to '[deleted]' (shown on every graduate's
--      verification and in the issuer registry).
--   3. erasure_requests.auth_user_id was ON DELETE CASCADE, so deleting the
--      auth account deleted the erasure record with it. The privacy policy
--      promises those records are kept for 7 years.
--   4. institution_users.auth_user_id was ON DELETE CASCADE too, so deleting
--      a former staff member's account deleted their membership rows: the
--      only record that they once held issuing rights for an institution,
--      which must stay auditable because credentials were signed under it.
--
-- Decisions (2026-10-29):
--   - Deletion is account-only: login, profile (email, name, notification
--     preferences) and the link from the student roster to the account.
--     The roster record and its credentials belong to the institution and
--     stay verifiable; requests to remove them go to the institution, which
--     is the data controller for those records.
--   - Only students self-serve deletion (/api/account/erase refuses
--     institution staff and admins). Staff and admins are removed through
--     support, using the Team page or the admin POC handover; see
--     docs/support-procedures.md §4.
--   - Erasure records keep the account id after the account is deleted, so
--     a completed request can still be evidenced. The id identifies nobody
--     once the account no longer exists.
--   - Membership rows outlive the account: the link is set to NULL and the
--     row is kept, with its role and dates, as history.
--
-- What this file does:
--   1. Rewrites process_erasure() to do exactly the account-level erasure.
--      Grants are unchanged (service role only, see 20261029010000).
--   2. Removes the foreign key from erasure_requests.auth_user_id to
--      auth.users, keeping the column and its value.
--   3. Makes institution_users.auth_user_id nullable and ON DELETE SET NULL,
--      and adds a trigger that marks a membership 'deactivated' when its
--      account link is cleared. Without it a deleted account that was still
--      'active' or 'invited' would linger as a nameless member that the Team
--      page lists and continuity checks count as able to issue.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Account-level erasure
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_erasure(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Lock the request row and validate it.
    SELECT auth_user_id INTO v_user_id
    FROM public.erasure_requests
    WHERE id = p_request_id AND status IN ('pending', 'processing')
    FOR UPDATE SKIP LOCKED;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Erasure request % not found or already processed', p_request_id;
    END IF;

    UPDATE public.erasure_requests
    SET status = 'processing'
    WHERE id = p_request_id;

    -- Unlink the roster record from the account. The record itself, and the
    -- credentials issued against it, belong to the institution and stay
    -- verifiable.
    UPDATE public.students
    SET auth_user_id = NULL
    WHERE auth_user_id = v_user_id;

    -- Account-level personal data: email, full name, notification
    -- preferences. Deleting the auth account would cascade here anyway; doing
    -- it now means the data is gone even if that later step fails.
    DELETE FROM public.profiles
    WHERE id = v_user_id;

    UPDATE public.erasure_requests
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_request_id;
END;
$$;

COMMENT ON FUNCTION public.process_erasure(uuid) IS
    'Account-level erasure: unlinks the student roster record and deletes the profile. '
    'Roster records, credentials and institutions are retained. Service role only.';

-- ---------------------------------------------------------------------
-- 2. Erasure records outlive the account they describe
-- ---------------------------------------------------------------------
-- Found by what it references rather than by name, so this works whatever
-- the constraint is called and is a no-op once it is gone.
DO $$
DECLARE
    v_constraint text;
BEGIN
    FOR v_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 'public.erasure_requests'::regclass
          AND c.confrelid = 'auth.users'::regclass
          AND a.attname = 'auth_user_id'
    LOOP
        EXECUTE format('ALTER TABLE public.erasure_requests DROP CONSTRAINT %I', v_constraint);
    END LOOP;
END;
$$;

COMMENT ON COLUMN public.erasure_requests.auth_user_id IS
    'Account the request was for. Deliberately not a foreign key: the record must survive '
    'deletion of the account (kept 7 years as evidence the request was completed).';

-- ---------------------------------------------------------------------
-- 3. Membership history outlives the account
-- ---------------------------------------------------------------------
ALTER TABLE public.institution_users ALTER COLUMN auth_user_id DROP NOT NULL;

-- Replace the CASCADE foreign key on auth_user_id only. invited_by and
-- removed_by also reference auth.users and are already ON DELETE SET NULL.
DO $$
DECLARE
    v_constraint text;
BEGIN
    FOR v_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 'public.institution_users'::regclass
          AND c.confrelid = 'auth.users'::regclass
          AND a.attname = 'auth_user_id'
    LOOP
        EXECUTE format('ALTER TABLE public.institution_users DROP CONSTRAINT %I', v_constraint);
    END LOOP;
END;
$$;

ALTER TABLE public.institution_users
    ADD CONSTRAINT institution_users_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

-- A membership whose account is gone can never be active or pending. Fires
-- for the foreign key's SET NULL as for any UPDATE. Named to sort before
-- trg_sync_institution_user_status, which then brings is_active in line.
CREATE OR REPLACE FUNCTION public.deactivate_unlinked_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.auth_user_id IS NULL
       AND OLD.auth_user_id IS NOT NULL
       AND NEW.status IS DISTINCT FROM 'deactivated' THEN
        NEW.status := 'deactivated';
        NEW.removed_at := coalesce(NEW.removed_at, NOW());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deactivate_unlinked_membership ON public.institution_users;
CREATE TRIGGER trg_deactivate_unlinked_membership
    BEFORE UPDATE ON public.institution_users
    FOR EACH ROW EXECUTE FUNCTION public.deactivate_unlinked_membership();

COMMENT ON COLUMN public.institution_users.auth_user_id IS
    'Member''s account. Set to NULL (and the row deactivated) when the account is deleted, '
    'so the record of who held which role survives.';

COMMIT;
