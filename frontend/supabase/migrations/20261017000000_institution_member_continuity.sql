-- =====================================================================
-- ACREDIA-STELLAR — INSTITUTION MEMBER CONTINUITY (IDEMPOTENT)
-- Issue #307: Institutions still depend on a single point of contact
-- =====================================================================
-- What this file does:
--   1. Gives each membership its own invitation lifecycle (invited_at,
--      invite_expires_at, accepted_at) and removal record (removed_at,
--      removed_by). Until now the invite window lived only on
--      `institutions`, which describes the first POC — a second member's
--      invitation had nowhere to live.
--   2. Adds `change_institution_member()`, the only path self-service member
--      management uses to remove or re-role a member. It locks the
--      institution's membership rows and refuses any change that would leave
--      the institution with no active owner, or no active member with issuing
--      rights. Doing the check inside one locked transaction is what stops two
--      owners removing each other at the same moment.
--   3. Extends the audit vocabulary for member invites, removals and role
--      changes.
--   4. Records `provisioning_origin = 'admin'` on every institution still
--      missing it. Admin provisioning never set the column, so the triage step
--      of 20260809 classified such rows only by `created_by_admin_id` — which
--      is ON DELETE SET NULL. Once the provisioning admin's account was
--      deleted, the next re-run of schema.sql would have suspended the
--      institution and deactivated every member.
--
-- Admin-only paths (POC handover, GDPR erasure) are deliberately outside the
-- guard: handover replaces the last owner by design, and erasure is a legal
-- obligation that is confirmed by the user and audited instead of blocked.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Per-membership invitation and removal lifecycle
-- ---------------------------------------------------------------------
ALTER TABLE public.institution_users
    ADD COLUMN IF NOT EXISTS invited_at        TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS removed_at        TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS removed_by        UUID REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.institution_users.invite_expires_at IS
    'When an `invited` membership stops being acceptable. NULL on rows that predate per-member invites; those are governed by the auth link''s own expiry.';

COMMENT ON COLUMN public.institution_users.removed_by IS
    'The member (or admin) who removed this membership. Removal deactivates the row; it is never deleted, so the audit trail survives.';

-- Pending POC invitations already carry their window on `institutions`; copy
-- it down so the per-member check sees the same deadline.
UPDATE public.institution_users iu
SET invited_at        = COALESCE(iu.invited_at, i.invited_at),
    invite_expires_at = COALESCE(iu.invite_expires_at, i.invite_expires_at)
FROM public.institutions i
WHERE i.id = iu.institution_id
  AND iu.status = 'invited'
  AND iu.invite_expires_at IS NULL;

-- Active memberships were accepted at some point; record the best-known time.
UPDATE public.institution_users iu
SET accepted_at = COALESCE(i.invite_accepted_at, iu.created_at)
FROM public.institutions i
WHERE i.id = iu.institution_id
  AND iu.status = 'active'
  AND iu.accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_institution_users_institution_status
    ON public.institution_users (institution_id, status);

-- ---------------------------------------------------------------------
-- 2. Guarded member changes
-- ---------------------------------------------------------------------
-- Role groups mirror src/lib/institutionMembership.ts:
--   may manage members: owner, poc
--   may issue:          owner, issuer, admin, poc
CREATE OR REPLACE FUNCTION public.change_institution_member(
    p_institution_id UUID,
    p_member_id      UUID,
    p_action         TEXT,
    p_new_role       TEXT DEFAULT NULL,
    p_actor_id       UUID DEFAULT NULL
)
RETURNS public.institution_users
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_target          public.institution_users;
    v_result          public.institution_users;
    v_manager_roles   CONSTANT TEXT[] := ARRAY['owner', 'poc'];
    v_issuer_roles    CONSTANT TEXT[] := ARRAY['owner', 'issuer', 'admin', 'poc'];
    v_role_after      TEXT;
    v_loses_manage    BOOLEAN;
    v_loses_issue     BOOLEAN;
    v_other_managers  INTEGER;
    v_other_issuers   INTEGER;
BEGIN
    IF p_action NOT IN ('remove', 'set_role') THEN
        RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'set_role' AND p_new_role NOT IN ('owner', 'issuer', 'viewer') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;

    -- Serialise every change to this institution's membership: a concurrent
    -- caller blocks here until this transaction commits, then recounts.
    PERFORM 1
    FROM public.institution_users
    WHERE institution_id = p_institution_id
    FOR UPDATE;

    SELECT * INTO v_target
    FROM public.institution_users
    WHERE id = p_member_id
      AND institution_id = p_institution_id;

    IF NOT FOUND OR v_target.status = 'deactivated' THEN
        RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Only an active member counts towards continuity. Withdrawing a pending
    -- invite, or re-roling one, can never strand the institution.
    IF v_target.status = 'active' THEN
        v_role_after := CASE WHEN p_action = 'remove' THEN NULL ELSE p_new_role END;

        v_loses_manage := v_target.role = ANY (v_manager_roles)
            AND (v_role_after IS NULL OR NOT v_role_after = ANY (v_manager_roles));
        v_loses_issue := v_target.role = ANY (v_issuer_roles)
            AND (v_role_after IS NULL OR NOT v_role_after = ANY (v_issuer_roles));

        IF v_loses_manage THEN
            SELECT COUNT(*) INTO v_other_managers
            FROM public.institution_users
            WHERE institution_id = p_institution_id
              AND status = 'active'
              AND id <> p_member_id
              AND role = ANY (v_manager_roles);

            IF v_other_managers = 0 THEN
                RAISE EXCEPTION 'last_owner'
                    USING ERRCODE = 'P0001',
                          HINT = 'Make another active member an owner first.';
            END IF;
        END IF;

        IF v_loses_issue THEN
            SELECT COUNT(*) INTO v_other_issuers
            FROM public.institution_users
            WHERE institution_id = p_institution_id
              AND status = 'active'
              AND id <> p_member_id
              AND role = ANY (v_issuer_roles);

            IF v_other_issuers = 0 THEN
                RAISE EXCEPTION 'last_issuer'
                    USING ERRCODE = 'P0001',
                          HINT = 'Give another active member issuing rights first.';
            END IF;
        END IF;
    END IF;

    IF p_action = 'remove' THEN
        UPDATE public.institution_users
        SET status     = 'deactivated',
            removed_at = NOW(),
            removed_by = p_actor_id
        WHERE id = p_member_id
        RETURNING * INTO v_result;
    ELSE
        UPDATE public.institution_users
        SET role = p_new_role
        WHERE id = p_member_id
        RETURNING * INTO v_result;
    END IF;

    -- The deprecated single-login column must never keep pointing at someone
    -- who lost owner rights: the app's legacy fallback reads it. Hand it to the
    -- longest-standing remaining owner (NULL only when withdrawing an invite
    -- from an institution with no active owner).
    IF p_action = 'remove' OR NOT p_new_role = ANY (v_manager_roles) THEN
        UPDATE public.institutions
        SET auth_user_id = (
            SELECT iu.auth_user_id
            FROM public.institution_users iu
            WHERE iu.institution_id = p_institution_id
              AND iu.status = 'active'
              AND iu.id <> p_member_id
              AND iu.role = ANY (v_manager_roles)
            ORDER BY iu.created_at
            LIMIT 1
        )
        WHERE id = p_institution_id
          AND auth_user_id = v_target.auth_user_id;
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.change_institution_member(UUID, UUID, TEXT, TEXT, UUID) IS
    'Removes or re-roles an institution member, refusing to leave the institution without an active owner or an active member with issuing rights (Issue #307). Service role only.';

REVOKE ALL ON FUNCTION public.change_institution_member(UUID, UUID, TEXT, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_institution_member(UUID, UUID, TEXT, TEXT, UUID)
    TO service_role;

-- ---------------------------------------------------------------------
-- 3. Pin the provisioning origin of admin-created institutions
-- ---------------------------------------------------------------------
-- 20260809 classified every institution that existed when it first ran, and
-- public signup has been closed since, so a row still NULL here can only have
-- come from admin provisioning.
UPDATE public.institutions
SET provisioning_origin = 'admin'
WHERE provisioning_origin IS NULL;

-- ---------------------------------------------------------------------
-- 4. Audit vocabulary for self-service member management
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
            'claim_wallet_success',
            'invite_member',
            'resend_member_invite',
            'remove_member',
            'change_member_role'
        )
    );

COMMIT;
