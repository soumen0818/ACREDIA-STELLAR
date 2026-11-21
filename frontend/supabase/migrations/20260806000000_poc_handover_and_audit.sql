-- =====================================================================
-- ACREDIA-STELLAR — POC HANDOVER, AUDIT LOGGING & MULTI-USER (IDEMPOTENT)
-- Issue #242: Email deliverability, account recovery, and POC handover
-- =====================================================================
-- What this file does:
--   1. Adds `is_active`, `deactivated_at`, and `deactivated_reason` columns to `public.profiles`.
--   2. Adds `public.admin_audit_logs` table for tracking administrative actions
--      including POC handovers, fallback link generation, and account deactivations.
--   3. Adds `public.institution_users` table to support multiple users per institution
--      for business continuity and role assignment (poc, admin, member).
--   4. Configures Row Level Security (RLS) policies for audit logs and institution users.
--   5. Backfills existing institution users from `institutions.auth_user_id`.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. Profile deactivation columns
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;

COMMENT ON COLUMN public.profiles.is_active IS
    'Whether this user account is active. When false, user cannot perform privileged actions. Replaced POC accounts are deactivated, never deleted.';

-- ---------------------------------------------------------------------
-- 2. Admin Audit Logs table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action                 TEXT NOT NULL CHECK (action IN ('poc_handover', 'generate_recovery_link', 'generate_invite_link', 'deactivate_account', 'update_institution')),
    actor_admin_id         UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    target_institution_id  UUID REFERENCES public.institutions (id) ON DELETE CASCADE,
    requester_email        TEXT,
    previous_poc_email     TEXT,
    previous_poc_id        UUID,
    new_poc_email          TEXT,
    new_poc_id             UUID,
    details                JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_hash                TEXT,
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.admin_audit_logs IS
    'Audit trail for high-privilege administrative actions, POC handovers, direct recovery links, and account status changes.';

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_institution
    ON public.admin_audit_logs (target_institution_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action
    ON public.admin_audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor
    ON public.admin_audit_logs (actor_admin_id, created_at DESC);

ALTER TABLE IF EXISTS public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Read: admins only
DROP POLICY IF EXISTS "Admin can view admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admin can view admin audit logs"
    ON public.admin_audit_logs FOR SELECT
    USING (public.is_admin());

-- Write: Service-role only via API routes (no direct user INSERT)
DROP POLICY IF EXISTS "Admin can insert admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admin can insert admin audit logs"
    ON public.admin_audit_logs FOR INSERT
    WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Institution Users table (Multi-User Support)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institution_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institution_id  UUID NOT NULL REFERENCES public.institutions (id) ON DELETE CASCADE,
    auth_user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member', 'poc')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, auth_user_id)
);

COMMENT ON TABLE public.institution_users IS
    'Maps authenticated users to institutions, allowing multiple authorized personnel per institution to prevent single-point-of-failure lockouts.';

CREATE INDEX IF NOT EXISTS idx_institution_users_inst
    ON public.institution_users (institution_id, is_active);

CREATE INDEX IF NOT EXISTS idx_institution_users_user
    ON public.institution_users (auth_user_id);

ALTER TABLE IF EXISTS public.institution_users ENABLE ROW LEVEL SECURITY;

-- Institution members can view colleagues in their institution
-- Re-run safety (#308): only while institutions.auth_user_id exists. On a
-- fresh install it always does here; after the column is dropped, re-applying
-- schema.sql skips this legacy block (a later migration supersedes it).
DO $guard$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
) THEN
DROP POLICY IF EXISTS "Institution members can view colleagues" ON public.institution_users;
CREATE POLICY "Institution members can view colleagues"
    ON public.institution_users FOR SELECT
    USING (
        institution_id IN (
            SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
            UNION
            SELECT institution_id FROM public.institution_users WHERE auth_user_id = auth.uid() AND is_active = true
        )
    );
END IF;
END
$guard$;


-- Admins can view and manage all institution users
DROP POLICY IF EXISTS "Admin can view all institution users" ON public.institution_users;
CREATE POLICY "Admin can view all institution users"
    ON public.institution_users FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can manage all institution users" ON public.institution_users;
CREATE POLICY "Admin can manage all institution users"
    ON public.institution_users FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. Backfill institution_users from existing institutions
-- ---------------------------------------------------------------------
-- Re-run safety (#308): only while institutions.auth_user_id exists. On a
-- fresh install it always does here; after the column is dropped, re-applying
-- schema.sql skips this legacy block (a later migration supersedes it).
DO $guard$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'
) THEN
INSERT INTO public.institution_users (institution_id, auth_user_id, role, is_active)
SELECT id, auth_user_id, 'poc', true
FROM public.institutions
WHERE auth_user_id IS NOT NULL
ON CONFLICT (institution_id, auth_user_id) DO NOTHING;
END IF;
END
$guard$;


COMMIT;
