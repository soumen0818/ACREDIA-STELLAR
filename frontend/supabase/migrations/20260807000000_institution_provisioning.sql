-- =====================================================================
-- ACREDIA-STELLAR — ADMIN INSTITUTION PROVISIONING (IDEMPOTENT)
-- Issue #240: Admin provisions institutions and issues invite links
-- =====================================================================
-- What this file does:
--   1. Adds provisioning metadata columns to `public.institutions`
--      (country, accreditation reference, internal notes, provisioning admin).
--   2. Adds onboarding-state timestamps so a half-finished onboarding is
--      visible: invited -> active -> wallet authorized.
--   3. Extends the `admin_audit_logs.action` check constraint with the
--      provisioning actions introduced by this issue.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Provisioning metadata + onboarding state on institutions
-- ---------------------------------------------------------------------
ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS poc_name              TEXT,
    ADD COLUMN IF NOT EXISTS country               TEXT,
    ADD COLUMN IF NOT EXISTS accreditation_ref     TEXT,
    ADD COLUMN IF NOT EXISTS internal_notes        TEXT,
    ADD COLUMN IF NOT EXISTS created_by_admin_id   UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invited_at            TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS invite_expires_at     TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS invite_accepted_at    TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.institutions.created_by_admin_id IS
    'Admin who provisioned this institution. Part of the provisioning audit trail (see admin_audit_logs).';

COMMENT ON COLUMN public.institutions.invited_at IS
    'When the current invite link was generated. Regenerating an invite moves this forward and invalidates the previous link.';

COMMENT ON COLUMN public.institutions.invite_accepted_at IS
    'When the POC consumed the invite and set their own password. NULL means onboarding is still pending.';

COMMENT ON COLUMN public.institutions.internal_notes IS
    'Acredia-internal provisioning notes. Never exposed to institution users.';

-- Surfacing "who still has not accepted their invite" is the primary
-- onboarding query, so index the pending case directly.
CREATE INDEX IF NOT EXISTS idx_institutions_pending_invites
    ON public.institutions (invited_at DESC)
    WHERE invite_accepted_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. Extend the audit action vocabulary with provisioning actions
-- ---------------------------------------------------------------------
ALTER TABLE public.admin_audit_logs
    DROP CONSTRAINT IF EXISTS admin_audit_logs_action_check;

-- NOT VALID: on a re-run of schema.sql, existing rows already carry actions
-- that later migrations admit. Validating them against this older list would
-- abort the re-run here (Issue #307). The latest migration that redefines this
-- constraint adds it validated, so the final schema still checks every row.
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
            'accept_invite'
        )
    ) NOT VALID;

COMMIT;
