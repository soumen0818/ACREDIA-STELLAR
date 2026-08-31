-- =====================================================================
-- ACREDIA-STELLAR — STUDENT PROVISIONING & WALLET CLAIM (IDEMPOTENT)
-- Issue #241: Institutions provision and manage their students
-- Issue #243: Students holding a credential but no account can claim one
-- =====================================================================
-- What this file does:
--   1. Gives `public.students` an owning institution, lifecycle status, and
--      invite/claim bookkeeping, so a roster is authoritative rather than
--      "whoever happened to sign up".
--   2. Adds `public.wallet_claim_nonces` for the wallet-ownership claim flow.
--   3. Rewrites the student RLS policies so an institution sees exactly its
--      own students, and a student sees only themselves.
--   4. Records the access-model decision (Issue #243, Option C).
--
-- ACCESS MODEL DECISION (Issue #243): Option C — both paths.
--   Institution-provisioned accounts are the default. Wallet-ownership claim
--   is the fallback for students the institution never provisioned, so that
--   wallet-first bulk issuance is not blocked on collecting a valid email for
--   every student up front.
--
-- LOST-WALLET RECOVERY: the claim flow collects an email and password, so a
--   claimed account is recoverable through the ordinary password-reset flow.
--   The wallet proves ownership once at claim time; it is not the ongoing
--   login credential. Losing the wallet does not lose the account, and never
--   affects already-issued credentials, which live on-chain.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. Student ownership + lifecycle
-- ---------------------------------------------------------------------
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS institution_id     UUID REFERENCES public.institutions (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS student_ref        TEXT,
    ADD COLUMN IF NOT EXISTS status             TEXT,
    ADD COLUMN IF NOT EXISTS provisioning_origin TEXT,
    ADD COLUMN IF NOT EXISTS invited_at         TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS invite_expires_at  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS invite_accepted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS claimed_at         TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deactivated_reason TEXT,
    ADD COLUMN IF NOT EXISTS created_by         UUID REFERENCES auth.users (id) ON DELETE SET NULL;

-- Existing rows predate provisioning and came from the removed signup flow.
UPDATE public.students SET status = 'active' WHERE status IS NULL;
UPDATE public.students
SET provisioning_origin = CASE WHEN auth_user_id IS NULL THEN 'institution' ELSE 'self_signup' END
WHERE provisioning_origin IS NULL;

ALTER TABLE public.students ALTER COLUMN status SET DEFAULT 'invited';
ALTER TABLE public.students ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE public.students
    ADD CONSTRAINT students_status_check
    CHECK (status IN ('invited', 'active', 'deactivated'));

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_provisioning_origin_check;
ALTER TABLE public.students
    ADD CONSTRAINT students_provisioning_origin_check
    CHECK (provisioning_origin IS NULL OR provisioning_origin IN ('institution', 'claim', 'self_signup'));

COMMENT ON COLUMN public.students.institution_id IS
    'The institution that provisioned this student. NULL for a self-claimed student who is not yet on any roster.';

COMMENT ON COLUMN public.students.status IS
    'invited = provisioned, has not accepted; active = may sign in; deactivated = access removed. Deactivation NEVER revokes or hides issued credentials.';

COMMENT ON COLUMN public.students.student_ref IS
    'The institution''s own student identifier (roll number, enrolment id). Unique within an institution, not globally.';

-- A student number is unique within its institution, not across Acredia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_institution_ref
    ON public.students (institution_id, student_ref)
    WHERE student_ref IS NOT NULL AND institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_institution
    ON public.students (institution_id, status);

CREATE INDEX IF NOT EXISTS idx_students_wallet
    ON public.students (wallet_address)
    WHERE wallet_address IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Wallet claim nonces
-- ---------------------------------------------------------------------
-- The challenge a student signs to prove they control the wallet a credential
-- was issued to. Server-issued, single-use, short-lived, and bound to one
-- wallet address — a client-supplied challenge is never trusted.
CREATE TABLE IF NOT EXISTS public.wallet_claim_nonces (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL,
    nonce          TEXT NOT NULL UNIQUE,
    expires_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at    TIMESTAMP WITH TIME ZONE,
    ip_hash        TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.wallet_claim_nonces IS
    'Single-use, short-lived challenges for the wallet-ownership claim flow (Issue #243). Bound to one wallet address; consumed on first successful verification.';

CREATE INDEX IF NOT EXISTS idx_wallet_claim_nonces_wallet
    ON public.wallet_claim_nonces (wallet_address, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_claim_nonces_expiry
    ON public.wallet_claim_nonces (expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE IF EXISTS public.wallet_claim_nonces ENABLE ROW LEVEL SECURITY;

-- No client may read or write nonces: the claim routes use the service role.
-- Without a permissive policy, RLS denies everything by default, which is the
-- intended posture for a challenge table.
DROP POLICY IF EXISTS "Admin can view wallet claim nonces" ON public.wallet_claim_nonces;
CREATE POLICY "Admin can view wallet claim nonces"
    ON public.wallet_claim_nonces FOR SELECT
    USING (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Student RLS — institution-scoped, cross-institution isolated
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can view own data" ON public.students;
CREATE POLICY "Students can view own data"
  ON public.students FOR SELECT
  USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Students can update own data" ON public.students;
CREATE POLICY "Students can update own data"
  ON public.students FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- An institution sees exactly the students it provisioned — never another
-- institution's roster. `user_institution_ids()` (Issue #238) resolves
-- membership, so any active member of the institution qualifies.
DROP POLICY IF EXISTS "Institutions can view own students" ON public.students;
CREATE POLICY "Institutions can view own students"
  ON public.students FOR SELECT
  USING (institution_id IN (SELECT public.user_institution_ids()));

DROP POLICY IF EXISTS "Institutions can insert own students" ON public.students;
CREATE POLICY "Institutions can insert own students"
  ON public.students FOR INSERT
  WITH CHECK (institution_id IN (SELECT public.user_issuer_institution_ids()));

DROP POLICY IF EXISTS "Institutions can update own students" ON public.students;
CREATE POLICY "Institutions can update own students"
  ON public.students FOR UPDATE
  USING (institution_id IN (SELECT public.user_issuer_institution_ids()))
  WITH CHECK (institution_id IN (SELECT public.user_issuer_institution_ids()));

-- Deliberately no DELETE policy: students are deactivated, never deleted,
-- because credentials reference them with ON DELETE RESTRICT.

-- ---------------------------------------------------------------------
-- 4. Audit vocabulary for student provisioning and claims
-- ---------------------------------------------------------------------
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
            'triage_self_signup',
            'create_student',
            'update_student',
            'deactivate_student',
            'reactivate_student',
            'bulk_import_students',
            'generate_student_invite',
            'claim_wallet_attempt',
            'claim_wallet_success'
        )
    );

COMMIT;
