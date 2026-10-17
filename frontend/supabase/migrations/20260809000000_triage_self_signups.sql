-- =====================================================================
-- ACREDIA-STELLAR — TRIAGE SELF-SIGNUP ACCOUNTS (IDEMPOTENT)
-- Issue #239: Remove public self-signup; move to closed provisioning
-- =====================================================================
-- What this file does:
--   1. Records a provisioning origin on `public.institutions`, so a
--      self-registered row is distinguishable from a provisioned one.
--   2. Triages existing institutions: rows that no admin ever provisioned are
--      SUSPENDED, never deleted, with the decision and its basis recorded.
--   3. Closes the self-insert paths that public signup depended on, including
--      the signup mirror triggers that created rows from auth metadata.
--
-- Suspension is deliberately reversible: an institution that turns out to be
-- legitimate is reinstated by an admin setting status back to 'pending', with
-- the audit row below explaining why it was suspended in the first place.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Provisioning origin
-- ---------------------------------------------------------------------
ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS provisioning_origin TEXT;

ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_provisioning_origin_check;

ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_provisioning_origin_check
    CHECK (provisioning_origin IS NULL OR provisioning_origin IN ('admin', 'self_signup'));

COMMENT ON COLUMN public.institutions.provisioning_origin IS
    'How this institution came to exist: admin = provisioned through the admin console; self_signup = created by the removed public registration flow (Issue #239).';

-- An institution carrying a provisioning admin, or an invite, was created
-- through the console (Issue #240). Everything else predates that and came
-- from public signup. `invited_at` matters on a re-run of schema.sql:
-- `created_by_admin_id` is ON DELETE SET NULL, so once the provisioning admin's
-- account is gone it alone would misfile — and then suspend — a legitimate
-- institution (Issue #307). Public signup never set an invite.
UPDATE public.institutions
SET provisioning_origin = 'admin'
WHERE provisioning_origin IS NULL
  AND (created_by_admin_id IS NOT NULL OR invited_at IS NOT NULL);

UPDATE public.institutions
SET provisioning_origin = 'self_signup'
WHERE provisioning_origin IS NULL;

-- ---------------------------------------------------------------------
-- 2. Triage — suspend the unvetted, keep everything recoverable
-- ---------------------------------------------------------------------
-- The triage decision is an audited administrative action, so the action
-- vocabulary has to admit it before any row is filed.
ALTER TABLE public.admin_audit_logs
    DROP CONSTRAINT IF EXISTS admin_audit_logs_action_check;

ALTER TABLE public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_action_check CHECK (
        action IN (
            'poc_handover',
            'generate_recovery_link',
            'generate_invite_link',
            'regenerate_invite_link',
            'deactivate_account',
            'update_institution',
            'create_institution',
            'accept_invite',
            'triage_self_signup'
        )
    -- NOT VALID: see 20260807 — a re-run must not abort on later actions.
    ) NOT VALID;

-- A self-signup that an admin already authorized on-chain has been vetted by
-- the only act that actually matters, so it is left alone. The rest are
-- suspended pending review: they can occupy the database, but not act.
WITH triaged AS (
    UPDATE public.institutions
    SET status = 'suspended'
    WHERE provisioning_origin = 'self_signup'
      AND authorization_tx_hash IS NULL
      AND verified = false
      AND status NOT IN ('suspended', 'rejected')
    RETURNING id, name, email
)
INSERT INTO public.admin_audit_logs (action, target_institution_id, new_poc_email, details)
SELECT
    'triage_self_signup',
    triaged.id,
    triaged.email,
    jsonb_build_object(
        'decision', 'suspended',
        'basis', 'Created through the public signup flow removed in Issue #239; never authorized on-chain and never verified by an admin.',
        'reversible', true,
        'reinstatement', 'An admin may set status back to pending after confirming the institution is legitimate.',
        'institutionName', triaged.name
    )
FROM triaged
-- Re-running the migration must not file the same decision twice.
WHERE NOT EXISTS (
    SELECT 1 FROM public.admin_audit_logs existing
    WHERE existing.target_institution_id = triaged.id
      AND existing.action = 'triage_self_signup'
);

-- Deactivate the memberships of suspended institutions, so a suspended row
-- cannot still be acted on through the membership relation (Issue #238).
UPDATE public.institution_users iu
SET status = 'deactivated'
FROM public.institutions i
WHERE i.id = iu.institution_id
  AND i.status = 'suspended'
  AND i.provisioning_origin = 'self_signup'
  AND iu.status <> 'deactivated';

-- ---------------------------------------------------------------------
-- 3. Close the self-insert paths
-- ---------------------------------------------------------------------
-- The signup mirror triggers created institution and student rows straight
-- from auth metadata whenever an auth user appeared. With provisioning closed,
-- that is precisely the hole this issue exists to shut: accounts are created
-- by an admin (institutions) or an institution (students), both of which use
-- the service role and insert explicitly.
DROP TRIGGER IF EXISTS on_auth_user_created_institution ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_student ON auth.users;

DROP FUNCTION IF EXISTS public.handle_new_institution_user();
DROP FUNCTION IF EXISTS public.handle_new_student_user();

-- No client-side role may insert an institution. Issue #238 already dropped
-- the institutions self-insert policy; students kept theirs for the signup
-- flow that no longer exists.
DROP POLICY IF EXISTS "Students can insert own data" ON public.students;

COMMIT;
