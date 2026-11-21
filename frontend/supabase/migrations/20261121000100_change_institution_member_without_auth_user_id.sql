-- =====================================================================
-- ACREDIA-STELLAR — change_institution_member() without the dropped column
-- Issue #308 follow-up
-- =====================================================================
-- 20261121000000 dropped public.institutions.auth_user_id, but
-- change_institution_member() — the RPC behind "remove member" and "change
-- role" (src/lib/institutionMembers.ts) — still ended with
--
--     UPDATE public.institutions SET auth_user_id = ... WHERE ... ;
--
-- PL/pgSQL bodies are not dependency-tracked, so the DROP COLUMN succeeded
-- and every removal or demotion of an owner then failed at runtime with
-- `column "auth_user_id" does not exist`.
--
-- That block only kept the legacy column pointing at a remaining owner for
-- the app's legacy fallback, which #308 removed. Everything else — the
-- per-institution lock, the last_owner / last_issuer guards, the removal
-- record — is unchanged. CREATE OR REPLACE keeps the existing grants
-- (service_role only; 20261017000000 and 20261029010000).
-- =====================================================================

BEGIN;

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

    RETURN v_result;
END;
$$;

COMMIT;
