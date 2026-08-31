-- ============================================================================
-- ACREDIA — Full database schema (generated; do not edit by hand)
--
-- Regenerate with:  npm run db:schema
-- Source of truth:  supabase/migrations/*.sql
--
-- HOW TO USE
--   Supabase dashboard → SQL Editor → paste this whole file → Run.
--
-- SAFE TO RE-RUN. Every statement is idempotent:
--   • CREATE TABLE / INDEX ... IF NOT EXISTS
--   • ADD COLUMN ... IF NOT EXISTS
--   • CREATE OR REPLACE FUNCTION
--   • DROP POLICY / TRIGGER IF EXISTS before each CREATE
-- Existing objects are skipped; missing ones are created. No data is dropped.
--
-- Generated: 2026-08-28T09:13:16Z
-- ============================================================================


-- ============================================================================
-- migration: 20260730000000_initial_schema.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — FULL DATABASE SETUP (SINGLE FILE, IDEMPOTENT)
-- =====================================================================
-- Run this once on a NEW Supabase project after changing credentials.
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS / DROP-before-CREATE
-- and DO $$ ... $$ if/else blocks so nothing errors on a second run.
--
-- This consolidates:
--   1. database_schema.sql          (tables, triggers, indexes, base RLS)
--   2. add_credential_hash_metadata (hash/version columns)
--   3. secure_rls_migration.sql     (production RLS policy set + is_admin)
--
-- After running this SQL, update frontend/.env.local with the new
-- NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / service key.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Profiles (role mirror: admin / institution / student)
CREATE TABLE IF NOT EXISTS public.profiles (
    id         UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email      TEXT UNIQUE NOT NULL,
    role       TEXT NOT NULL,
    full_name  TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Institutions
CREATE TABLE IF NOT EXISTS public.institutions (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    auth_user_id          UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    name                  TEXT NOT NULL,
    email                 TEXT UNIQUE NOT NULL,
    wallet_address        TEXT UNIQUE,
    verified              BOOLEAN DEFAULT false,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended', 'rejected')),
    authorization_tx_hash TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Students
CREATE TABLE IF NOT EXISTS public.students (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    auth_user_id   UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Credentials
CREATE TABLE IF NOT EXISTS public.credentials (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id              UUID REFERENCES public.students (id) ON DELETE RESTRICT,
    student_wallet_address  TEXT,
    institution_id          UUID REFERENCES public.institutions (id) ON DELETE RESTRICT,
    issuer_wallet_address   TEXT,
    token_id                TEXT UNIQUE NOT NULL,
    ipfs_hash               TEXT NOT NULL,
    blockchain_hash         TEXT NOT NULL,
    metadata                JSONB NOT NULL,
    metadata_schema_version INTEGER NOT NULL DEFAULT 1,
    hash_algorithm          TEXT NOT NULL DEFAULT 'sha256:canonical-json:v1',
    issued_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked                 BOOLEAN DEFAULT false,
    revoked_at              TIMESTAMP WITH TIME ZONE
);

-- Verification logs
CREATE TABLE IF NOT EXISTS public.verification_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    credential_id       UUID REFERENCES public.credentials (id) ON DELETE SET NULL,
    verifier_email      TEXT,
    verifier_org        TEXT,
    verification_result JSONB NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys for programmatic verification
CREATE TABLE IF NOT EXISTS public.api_keys (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    institution_id      UUID REFERENCES public.institutions (id) ON DELETE CASCADE,
    key_prefix          TEXT NOT NULL,
    key_hash            TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    revoked             BOOLEAN DEFAULT false,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.verification_logs IS
    'Privacy-safe audit log for public verification attempts. '
    'Stores coarse outcomes and hashed request identifiers only — no PII. '
    'Retention policy: rows are automatically purged after 90 days by '
    'public.purge_old_verification_logs() (scheduled via pg_cron).';

-- ---------------------------------------------------------------------
-- Credentials: ensure hash/version columns exist (for older DBs)
-- IF the columns are missing -> add them; ELSE leave as-is.
-- ---------------------------------------------------------------------
ALTER TABLE public.credentials
    ADD COLUMN IF NOT EXISTS metadata_schema_version INTEGER,
    ADD COLUMN IF NOT EXISTS hash_algorithm TEXT;

-- Stamp legacy rows that predate canonical hashing, then set defaults.
-- v0 means "legacy JSON.stringify(metadata)"; v1 means canonical JSON.
UPDATE public.credentials
SET metadata_schema_version = CASE
    WHEN hash_algorithm = 'sha256:canonical-json:v1' THEN 1
    ELSE 0
END
WHERE metadata_schema_version IS NULL;

UPDATE public.credentials
SET hash_algorithm = CASE
    WHEN metadata_schema_version = 0 THEN 'sha256:json-stringify'
    ELSE 'sha256:canonical-json:v1'
END
WHERE hash_algorithm IS NULL;

ALTER TABLE public.credentials
    ALTER COLUMN metadata_schema_version SET DEFAULT 1,
    ALTER COLUMN hash_algorithm SET DEFAULT 'sha256:canonical-json:v1',
    ALTER COLUMN metadata_schema_version SET NOT NULL,
    ALTER COLUMN hash_algorithm SET NOT NULL;

-- Database-level guard against deleting credentials (Issue #232)
CREATE OR REPLACE FUNCTION public.prevent_credential_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Deleting credentials is not allowed. They are immutable business records.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_credential_delete ON public.credentials;
CREATE TRIGGER block_credential_delete
    BEFORE DELETE ON public.credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_credential_deletion();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

-- Mirror new auth users into profiles. Client role metadata is NOT trusted
-- for admin: only 'institution' or 'student' is honored here.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    new.id,
    new.email,
    CASE
      WHEN new.raw_user_meta_data->>'role' = 'institution' THEN 'institution'
      ELSE 'student'
    END,
    new.raw_user_meta_data->>'name'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Block role escalation unless done by the trusted service_role.
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS trigger AS $$
BEGIN
  IF old.role IS DISTINCT FROM new.role AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Profile roles can only be changed by a trusted server-side admin process';
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create institution row on institution signup.
CREATE OR REPLACE FUNCTION public.handle_new_institution_user()
RETURNS trigger AS $$
BEGIN
  IF new.raw_user_meta_data->>'role' = 'institution' THEN
    INSERT INTO public.institutions (auth_user_id, name, email)
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email
    )
    ON CONFLICT (email) DO NOTHING;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Auto-create student row on student signup.
CREATE OR REPLACE FUNCTION public.handle_new_student_user()
RETURNS trigger AS $$
BEGIN
  IF new.raw_user_meta_data->>'role' = 'student' THEN
    INSERT INTO public.students (auth_user_id, name, email)
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email
    )
    ON CONFLICT (email) DO NOTHING;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Admin check helper used by RLS policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ---------------------------------------------------------------------
-- Triggers (drop-before-create so re-runs are clean)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_profile_role_escalation ON public.profiles;
CREATE TRIGGER prevent_profile_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.prevent_profile_role_escalation();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_institution ON auth.users;
CREATE TRIGGER on_auth_user_created_institution
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_institution_user();

DROP TRIGGER IF EXISTS on_auth_user_created_student ON auth.users;
CREATE TRIGGER on_auth_user_created_student
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_student_user();

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_institutions_auth_user      ON public.institutions (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_institutions_wallet         ON public.institutions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_students_auth_user          ON public.students (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_students_wallet             ON public.students (wallet_address);
CREATE INDEX IF NOT EXISTS idx_credentials_student         ON public.credentials (student_id);
CREATE INDEX IF NOT EXISTS idx_credentials_institution     ON public.credentials (institution_id);
CREATE INDEX IF NOT EXISTS idx_credentials_token           ON public.credentials (token_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_credential ON public.verification_logs (credential_id);
-- Pagination and filtering indexes (Issue #82)
CREATE INDEX IF NOT EXISTS idx_credentials_institution_issued
  ON public.credentials (institution_id, issued_at DESC, revoked);

CREATE INDEX IF NOT EXISTS idx_credentials_student_issued
  ON public.credentials (student_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_credentials_fts
  ON public.credentials USING gin(
    to_tsvector('english',
      COALESCE((metadata->>'studentName')::text, '') || ' ' ||
      COALESCE((metadata->>'credentialType')::text, '') || ' ' ||
      COALESCE((metadata->>'degree')::text, '') || ' ' ||
      COALESCE(token_id::text, '')
    )
  );

CREATE INDEX IF NOT EXISTS idx_credentials_institution_revoked
  ON public.credentials (institution_id, revoked, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_credentials_issued_at
  ON public.credentials (issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created_at ON public.verification_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_verification_logs_result_type
    ON public.verification_logs ((verification_result->>'result_type'));
CREATE INDEX IF NOT EXISTS idx_api_keys_institution         ON public.api_keys (institution_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash                ON public.api_keys (key_hash);

-- ---------------------------------------------------------------------
-- Enable Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.institutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_keys          ENABLE ROW LEVEL SECURITY;
-- NOTE: public.jobs, public.indexer_state, and public.credential_pins are
-- NOT created until later in this script (see the "Job queue" / "Indexer
-- State" / "Pin redundancy" sections below), so an ALTER TABLE IF EXISTS
-- here would silently no-op on a brand-new database. Each of those
-- sections enables RLS on itself immediately after its own CREATE TABLE
-- instead — do not add them here.

-- ---------------------------------------------------------------------
-- Drop any legacy / permissive policies before recreating (idempotent)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles are viewable by everyone"               ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"                    ON public.profiles;
DROP POLICY IF EXISTS "Profiles can view own profile"                   ON public.profiles;
DROP POLICY IF EXISTS "Profiles can update own profile"                 ON public.profiles;
DROP POLICY IF EXISTS "Admin can view all profiles"                     ON public.profiles;

DROP POLICY IF EXISTS "Institutions can view own data"                  ON public.institutions;
DROP POLICY IF EXISTS "Institutions can update own data"                ON public.institutions;
DROP POLICY IF EXISTS "Anyone can insert institutions"                  ON public.institutions;
DROP POLICY IF EXISTS "Public can count institutions"                   ON public.institutions;
DROP POLICY IF EXISTS "Admin can view all institutions"                 ON public.institutions;
DROP POLICY IF EXISTS "Admin can update institutions"                   ON public.institutions;
DROP POLICY IF EXISTS "Institutions can insert own data"                ON public.institutions;
DROP POLICY IF EXISTS "Authenticated users can read institution names"  ON public.institutions;

DROP POLICY IF EXISTS "Students can view own data"                      ON public.students;
DROP POLICY IF EXISTS "Students can update own data"                    ON public.students;
DROP POLICY IF EXISTS "Anyone can insert students"                      ON public.students;
DROP POLICY IF EXISTS "Public can count students"                       ON public.students;
DROP POLICY IF EXISTS "Admin can view all students"                     ON public.students;
DROP POLICY IF EXISTS "Admin can update students"                       ON public.students;
DROP POLICY IF EXISTS "Students can insert own data"                    ON public.students;

DROP POLICY IF EXISTS "Students can view own credentials"               ON public.credentials;
DROP POLICY IF EXISTS "Institutions can view issued credentials"        ON public.credentials;
DROP POLICY IF EXISTS "Institutions can insert credentials"             ON public.credentials;
DROP POLICY IF EXISTS "Institutions can update own credentials"         ON public.credentials;
DROP POLICY IF EXISTS "Public can view credentials for verification"    ON public.credentials;
DROP POLICY IF EXISTS "Admin can view all credentials"                  ON public.credentials;

DROP POLICY IF EXISTS "Anyone can insert verification logs"             ON public.verification_logs;
DROP POLICY IF EXISTS "Anyone can view verification logs"               ON public.verification_logs;
DROP POLICY IF EXISTS "Admin can view verification logs"                ON public.verification_logs;
DROP POLICY IF EXISTS "Admin can insert verification logs"              ON public.verification_logs;

DROP POLICY IF EXISTS "Institutions can view own api keys"              ON public.api_keys;
DROP POLICY IF EXISTS "Institutions can insert own api keys"            ON public.api_keys;
DROP POLICY IF EXISTS "Institutions can update own api keys"            ON public.api_keys;
DROP POLICY IF EXISTS "Admin can manage all api keys"                   ON public.api_keys;


-- ---------------------------------------------------------------------
-- Profiles policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles can view own profile" ON public.profiles;
CREATE POLICY "Profiles can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Profiles can update own profile" ON public.profiles;
CREATE POLICY "Profiles can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admin can view all profiles" ON public.profiles;
CREATE POLICY "Admin can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Institutions policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view own data" ON public.institutions;
CREATE POLICY "Institutions can view own data"
  ON public.institutions FOR SELECT
  USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Institutions can update own data" ON public.institutions;
CREATE POLICY "Institutions can update own data"
  ON public.institutions FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Institutions can insert own data" ON public.institutions;
CREATE POLICY "Institutions can insert own data"
  ON public.institutions FOR INSERT
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Authenticated users can read institution names" ON public.institutions;
CREATE POLICY "Authenticated users can read institution names"
  ON public.institutions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin can view all institutions" ON public.institutions;
CREATE POLICY "Admin can view all institutions"
  ON public.institutions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can update institutions" ON public.institutions;
CREATE POLICY "Admin can update institutions"
  ON public.institutions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Students policies
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

DROP POLICY IF EXISTS "Students can insert own data" ON public.students;
CREATE POLICY "Students can insert own data"
  ON public.students FOR INSERT
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Admin can view all students" ON public.students;
CREATE POLICY "Admin can view all students"
  ON public.students FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can update students" ON public.students;
CREATE POLICY "Admin can update students"
  ON public.students FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Credentials policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can view own credentials" ON public.credentials;
CREATE POLICY "Students can view own credentials"
  ON public.credentials FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Institutions can view issued credentials" ON public.credentials;
CREATE POLICY "Institutions can view issued credentials"
  ON public.credentials FOR SELECT
  USING (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Institutions can insert credentials" ON public.credentials;
CREATE POLICY "Institutions can insert credentials"
  ON public.credentials FOR INSERT
  WITH CHECK (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid() AND verified = true
    )
  );

DROP POLICY IF EXISTS "Institutions can update own credentials" ON public.credentials;
CREATE POLICY "Institutions can update own credentials"
  ON public.credentials FOR UPDATE
  USING (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid() AND verified = true
    )
  )
  WITH CHECK (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid() AND verified = true
    )
  );

DROP POLICY IF EXISTS "Admin can view all credentials" ON public.credentials;
CREATE POLICY "Admin can view all credentials"
  ON public.credentials FOR SELECT
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Verification logs policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can view verification logs" ON public.verification_logs;
CREATE POLICY "Admin can view verification logs"
  ON public.verification_logs FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can insert verification logs" ON public.verification_logs;
CREATE POLICY "Admin can insert verification logs"
  ON public.verification_logs FOR INSERT
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- API Keys policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Institutions can view own api keys" ON public.api_keys;
CREATE POLICY "Institutions can view own api keys"
  ON public.api_keys FOR SELECT
  USING (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Institutions can insert own api keys" ON public.api_keys;
CREATE POLICY "Institutions can insert own api keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Institutions can update own api keys" ON public.api_keys;
CREATE POLICY "Institutions can update own api keys"
  ON public.api_keys FOR UPDATE
  USING (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin can manage all api keys" ON public.api_keys;
CREATE POLICY "Admin can manage all api keys"
  ON public.api_keys FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Erasure requests table (created by gdpr_erasure.sql; policies here
-- ensure idempotent policy management in this consolidated setup file)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erasure_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    requested_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    failure_reason  TEXT
);

COMMENT ON TABLE public.erasure_requests IS
    'Data-subject right-to-erasure requests (GDPR Art. 17). '
    'A row is inserted when a user submits a deletion request and updated '
    'to completed once the server-side erasure process finishes.';

CREATE INDEX IF NOT EXISTS idx_erasure_requests_user
    ON public.erasure_requests (auth_user_id, status);

ALTER TABLE IF EXISTS public.erasure_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own erasure requests" ON public.erasure_requests;
CREATE POLICY "Users can view own erasure requests"
    ON public.erasure_requests FOR SELECT
    USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Admin can view all erasure requests" ON public.erasure_requests;
CREATE POLICY "Admin can view all erasure requests"
    ON public.erasure_requests FOR SELECT
    USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Job queue table (created by job_queue.sql; policies here
-- ensure idempotent policy management in this consolidated setup file)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT NOT NULL,
    payload          JSONB NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    run_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    locked_at        TIMESTAMP WITH TIME ZONE,
    locked_by        TEXT,
    error_log        TEXT,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.jobs IS
    'Postgres-backed job queue for background asynchronous tasks (re-pinning, indexing, notifications).';

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at
    ON public.jobs (status, run_at)
    WHERE status = 'pending';

ALTER TABLE IF EXISTS public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view jobs" ON public.jobs;
CREATE POLICY "Admin can view jobs"
    ON public.jobs FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can manage jobs" ON public.jobs;
CREATE POLICY "Admin can manage jobs"
    ON public.jobs FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Function: next_job(p_worker_id text)
-- Picks and locks the next pending job that is ready to run.
-- Uses FOR UPDATE SKIP LOCKED to prevent multiple workers from picking
-- the same job concurrently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_job(p_worker_id text)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job_id uuid;
BEGIN
    SELECT id INTO v_job_id
    FROM public.jobs
    WHERE status = 'pending' AND run_at <= NOW()
    ORDER BY run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_job_id IS NOT NULL THEN
        UPDATE public.jobs
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = p_worker_id,
            attempts = attempts + 1,
            updated_at = NOW()
        WHERE id = v_job_id;

        RETURN QUERY SELECT * FROM public.jobs WHERE id = v_job_id;
    END IF;
END;
$$;

-- next_job is NOT accessible to public / authenticated users.
REVOKE ALL ON FUNCTION public.next_job(text) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Indexer State
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.indexer_state (
    id TEXT PRIMARY KEY DEFAULT 'main',
    last_ledger INTEGER NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.indexer_state IS
    'Tracks the off-chain indexer progress syncing events from the Soroban contract.';

ALTER TABLE IF EXISTS public.indexer_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view indexer state" ON public.indexer_state;
CREATE POLICY "Admin can view indexer state"
    ON public.indexer_state FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can manage indexer state" ON public.indexer_state;
CREATE POLICY "Admin can manage indexer state"
    ON public.indexer_state FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Pin redundancy table (created by pin_redundancy.sql; definitions here
-- ensure idempotent setup in this consolidated setup file)
-- Issue #164: IPFS pin redundancy + re-pinning keeper
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credential_pins (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    credential_id       UUID NOT NULL REFERENCES public.credentials (id) ON DELETE CASCADE,
    cid                 TEXT NOT NULL,
    provider            TEXT NOT NULL CHECK (provider IN ('pinata', 'secondary')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'pinned', 'failed', 'not_configured', 'erased')),
    provider_request_id TEXT,
    last_checked_at     TIMESTAMP WITH TIME ZONE,
    last_error          TEXT,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (credential_id, provider)
);

COMMENT ON TABLE public.credential_pins IS
    'Per-credential, per-provider IPFS pin health. A credential is only '
    'safely retrievable while at least one row here is status = pinned. '
    'Maintained by the pin-keeper worker (worker/pinKeeper.ts) — see '
    'docs/ops/pin-redundancy.md for the durability guarantee this backs.';

CREATE INDEX IF NOT EXISTS idx_credential_pins_needs_check
    ON public.credential_pins (last_checked_at NULLS FIRST)
    WHERE status NOT IN ('pinned', 'erased');

CREATE INDEX IF NOT EXISTS idx_credential_pins_stale_pinned
    ON public.credential_pins (last_checked_at)
    WHERE status = 'pinned';

CREATE INDEX IF NOT EXISTS idx_credential_pins_credential
    ON public.credential_pins (credential_id);

ALTER TABLE IF EXISTS public.credential_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Institutions can view own credential pins" ON public.credential_pins;
CREATE POLICY "Institutions can view own credential pins"
    ON public.credential_pins FOR SELECT
    USING (
        credential_id IN (
            SELECT c.id FROM public.credentials c
            JOIN public.institutions i ON i.id = c.institution_id
            WHERE i.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Students can view own credential pins" ON public.credential_pins;
CREATE POLICY "Students can view own credential pins"
    ON public.credential_pins FOR SELECT
    USING (
        credential_id IN (
            SELECT c.id FROM public.credentials c
            JOIN public.students s ON s.id = c.student_id
            WHERE s.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admin can view all credential pins" ON public.credential_pins;
CREATE POLICY "Admin can view all credential pins"
    ON public.credential_pins FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can manage credential pins" ON public.credential_pins;
CREATE POLICY "Admin can manage credential pins"
    ON public.credential_pins FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.register_credential_pins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.credential_pins (credential_id, cid, provider, status)
    VALUES
        (NEW.id, NEW.ipfs_hash, 'pinata', 'pending'),
        (NEW.id, NEW.ipfs_hash, 'secondary', 'pending')
    ON CONFLICT (credential_id, provider) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_register_credential_pins ON public.credentials;
CREATE TRIGGER trg_register_credential_pins
    AFTER INSERT ON public.credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.register_credential_pins();

COMMIT;

-- =====================================================================
-- DONE. Verify tables exist (optional sanity check):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
-- =====================================================================


-- ============================================================================
-- migration: 20260730135800_add_notification_preferences.sql
-- ============================================================================

-- Add notification preferences to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"email_issued": true, "email_revoked": true, "email_verified": true}'::jsonb;

-- Comment for the new column
COMMENT ON COLUMN public.profiles.notification_preferences IS 'Stores user preferences for transactional emails';


-- ============================================================================
-- migration: 20260801000000_gdpr_erasure.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — GDPR ERASURE MIGRATION (IDEMPOTENT)
-- Issue #160: Privacy & compliance (GDPR) – erasure, policy, ToS
-- =====================================================================
-- Run AFTER FULL_SETUP.sql on any existing database.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.
--
-- What this file does:
--   1. Adds `erasure_requests` table to track data-subject erasure requests.
--   2. Adds `request_erasure()` — callable by authenticated users to submit
--      a deletion request (inserts a pending row).
--   3. Adds `process_erasure(request_id uuid)` — callable ONLY by the
--      service_role; nullifies / redacts PII from students, institutions,
--      profiles, and credentials.metadata, then marks the request completed.
--   4. Adds `purge_old_verification_logs()` — deletes verification_logs rows
--      older than 90 days.
--   5. Documents data-retention policy via COMMENT ON statements.
--
-- SCHEDULING: handled by 20260805000000_retention_enforcement.sql, which wraps
-- this function in public.run_retention_purge() and schedules it (pg_cron where
-- available, plus the /api/cron/retention route). Do NOT schedule
-- purge_old_verification_logs() directly — runs made through
-- run_retention_purge() are recorded in public.maintenance_runs, and an
-- unrecorded run is what issue #227 was about.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- Retention policy annotations
-- ---------------------------------------------------------------------
-- Superseded by the fuller annotation in
-- 20260805000000_retention_enforcement.sql, which runs after this file.
COMMENT ON TABLE public.verification_logs IS
    'Privacy-safe audit log for public verification attempts. '
    'Stores coarse outcomes and hashed request identifiers only — no PII. '
    'Retention policy: rows older than 90 days are deleted by '
    'public.purge_old_verification_logs(), scheduled through '
    'public.run_retention_purge().';

COMMENT ON COLUMN public.verification_logs.verifier_email IS
    'Optional: verifier-supplied email for audit purposes. '
    'Treated as pseudonymous data; purged after 90 days per retention policy.';

COMMENT ON COLUMN public.verification_logs.verifier_org IS
    'Optional: verifier-supplied organisation name. '
    'Treated as pseudonymous data; purged after 90 days per retention policy.';

COMMENT ON TABLE public.credentials IS
    'Issued academic credentials. The blockchain_hash column contains a '
    'SHA-256 hash that is also anchored on the Stellar blockchain and '
    'cannot be deleted (Art. 17(3)(b) GDPR: immutability required for '
    'public-interest record-keeping). The hash is NOT personal data — it '
    'does not reveal the credential content without the original document. '
    'On erasure: metadata and IPFS content are redacted/unpinned; the '
    'hash pointer row is retained with metadata replaced by {''redacted'':true}.';

COMMENT ON COLUMN public.credentials.ipfs_hash IS
    'IPFS CID of the encrypted credential document pinned to Pinata. '
    'On account erasure the content is unpinned via the Pinata API so it '
    'becomes inaccessible. The CID itself (a hash pointer) is retained in '
    'this column for audit continuity.';

-- ---------------------------------------------------------------------
-- Erasure requests table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erasure_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    requested_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    failure_reason  TEXT
);

COMMENT ON TABLE public.erasure_requests IS
    'Data-subject right-to-erasure requests (GDPR Art. 17). '
    'A row is inserted when a user submits a deletion request and updated '
    'to completed once the server-side erasure process finishes.';

CREATE INDEX IF NOT EXISTS idx_erasure_requests_user
    ON public.erasure_requests (auth_user_id, status);

ALTER TABLE IF EXISTS public.erasure_requests ENABLE ROW LEVEL SECURITY;

-- Users may only see their own request history.
DROP POLICY IF EXISTS "Users can view own erasure requests" ON public.erasure_requests;
CREATE POLICY "Users can view own erasure requests"
    ON public.erasure_requests FOR SELECT
    USING (auth.uid() = auth_user_id);

-- Insertion is handled through process_erasure() (service_role) and
-- request_erasure() (SECURITY DEFINER), so regular users have no direct INSERT.
DROP POLICY IF EXISTS "Admin can view all erasure requests" ON public.erasure_requests;
CREATE POLICY "Admin can view all erasure requests"
    ON public.erasure_requests FOR SELECT
    USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Function: request_erasure()
-- Authenticated users call this to submit an erasure request.
-- Returns the new request id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_erasure()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_id      uuid;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Prevent duplicate pending requests.
    IF EXISTS (
        SELECT 1 FROM public.erasure_requests
        WHERE auth_user_id = v_user_id AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'A pending erasure request already exists for this account';
    END IF;

    INSERT INTO public.erasure_requests (auth_user_id)
    VALUES (v_user_id)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_erasure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_erasure() TO authenticated;

-- ---------------------------------------------------------------------
-- Function: process_erasure(request_id uuid)
-- Called ONLY by the server-side API route via the service_role client.
-- Redacts PII in students, institutions, profiles, credentials.
-- The auth.users row is deleted by the API route (admin.deleteUser).
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

    -- Mark as processing.
    UPDATE public.erasure_requests
    SET status = 'processing'
    WHERE id = p_request_id;

    -- Redact student PII.
    UPDATE public.students
    SET
        name  = '[deleted]',
        email = NULL
    WHERE auth_user_id = v_user_id;

    -- Redact institution PII.
    UPDATE public.institutions
    SET
        name  = '[deleted]',
        email = NULL
    WHERE auth_user_id = v_user_id;

    -- Redact profile PII (email + full_name).
    UPDATE public.profiles
    SET
        email     = NULL,
        full_name = NULL
    WHERE id = v_user_id;

    -- Redact credential metadata (JSONB field may contain studentName etc.).
    -- ipfs_hash and blockchain_hash are retained as non-PII pointers.
    UPDATE public.credentials
    SET metadata = '{"redacted": true}'::jsonb
    WHERE student_id IN (
        SELECT id FROM public.students WHERE auth_user_id = v_user_id
    );

    -- Mark complete.
    UPDATE public.erasure_requests
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_request_id;
END;
$$;

-- process_erasure is NOT granted to authenticated users — only callable
-- by the server-side service_role client.
REVOKE ALL ON FUNCTION public.process_erasure(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Function: purge_old_verification_logs()
-- Deletes verification_log rows older than 90 days (data retention policy).
-- Called by public.run_retention_purge(); never scheduled on its own.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_verification_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.verification_logs
    WHERE created_at < NOW() - INTERVAL '90 days';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_verification_logs() FROM PUBLIC;

COMMIT;

-- =====================================================================
-- DONE. Verify new objects:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'erasure_requests';
--
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public'
--     AND routine_name IN ('request_erasure','process_erasure','purge_old_verification_logs');
-- =====================================================================


-- ============================================================================
-- migration: 20260802000000_contact_messages.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — CONTACT MESSAGES (IDEMPOTENT)
-- =====================================================================
-- Backs the public /contact form.
--
-- Design notes:
--   • Messages are written ONLY by the server (service_role) after the
--     API route has validated input and applied rate limiting, so there is
--     no public INSERT policy — anonymous users can never write directly.
--   • Nobody except an admin can read messages (they contain the sender's
--     name/email, i.e. personal data).
--   • ip_hash is an HMAC, never a raw IP, so the table stays privacy-safe
--     and consistent with verification_logs.
--
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.contact_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    message      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'read', 'replied', 'spam')),
    ip_hash      TEXT,
    user_agent   TEXT,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    handled_at   TIMESTAMP WITH TIME ZONE,

    -- Defence in depth: the API validates these too, but the database
    -- refuses obviously malformed or abusive payloads regardless of caller.
    CONSTRAINT contact_messages_name_len    CHECK (char_length(name) BETWEEN 2 AND 100),
    CONSTRAINT contact_messages_email_len   CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT contact_messages_email_shape CHECK (position('@' IN email) > 1),
    CONSTRAINT contact_messages_message_len CHECK (char_length(message) BETWEEN 10 AND 5000)
);

COMMENT ON TABLE public.contact_messages IS
    'Submissions from the public /contact form. Written server-side only '
    '(service_role) after validation + rate limiting; readable by admins only. '
    'ip_hash is an HMAC of the client IP — never a raw address.';

COMMENT ON COLUMN public.contact_messages.ip_hash IS
    'HMAC-SHA256 of the submitting IP, used for abuse investigation without '
    'storing personal network identifiers.';

CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at
    ON public.contact_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status
    ON public.contact_messages (status, created_at DESC);

-- Supports the per-IP flood check in the API route.
CREATE INDEX IF NOT EXISTS idx_contact_messages_ip_recent
    ON public.contact_messages (ip_hash, created_at DESC);

ALTER TABLE IF EXISTS public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Read: admins only (messages contain the sender's name + email).
DROP POLICY IF EXISTS "Admin can view contact messages" ON public.contact_messages;
CREATE POLICY "Admin can view contact messages"
    ON public.contact_messages FOR SELECT
    USING (public.is_admin());

-- Manage (update status / delete): admins only.
DROP POLICY IF EXISTS "Admin can manage contact messages" ON public.contact_messages;
CREATE POLICY "Admin can manage contact messages"
    ON public.contact_messages FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- NOTE: deliberately NO insert policy for anon/authenticated. Inserts happen
-- through the service-role client in /api/contact, which bypasses RLS after
-- validating and rate limiting the request.

COMMIT;

-- =====================================================================
-- DONE. Verify:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='contact_messages';
-- =====================================================================


-- ============================================================================
-- migration: 20260803000000_fix_next_job_queue_filter.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — FIX next_job() (IDEMPOTENT)
-- =====================================================================
-- Two bugs in the original public.next_job(p_worker_id text):
--
--   1. SIGNATURE MISMATCH — the email worker calls
--        rpc('next_job', { queue_name: 'send_email' })
--      but the function only accepted `p_worker_id`, so PostgREST could not
--      resolve it and every poll failed with
--        "Could not find the function public.next_job(queue_name) in the
--         schema cache"
--      i.e. the email worker could never claim a job.
--
--   2. NO QUEUE FILTERING — it selected ANY pending row from public.jobs,
--      ignoring `name`. Once a second job type exists (pin repair, indexing),
--      the email worker would claim those jobs and fail them as "unknown
--      email type", burning their retry budget.
--
-- This migration replaces it with a queue-aware version. The old single-arg
-- signature is dropped first: adding a parameter would create an overload and
-- an ambiguous-function error at call time.
--
-- Safe to re-run: DROP ... IF EXISTS + CREATE OR REPLACE.
-- =====================================================================

BEGIN;

-- Remove the old single-argument version so no ambiguous overload remains.
DROP FUNCTION IF EXISTS public.next_job(text);

-- Claim the next pending job for a specific queue.
--
-- `queue_name` matches public.jobs.name, so each worker only ever claims its
-- own job type. FOR UPDATE SKIP LOCKED lets several workers poll concurrently
-- without handing the same row to two of them.
CREATE OR REPLACE FUNCTION public.next_job(
    queue_name text,
    worker_id  text DEFAULT NULL
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job_id uuid;
BEGIN
    SELECT id INTO v_job_id
    FROM public.jobs
    WHERE status = 'pending'
      AND run_at <= NOW()
      AND name = queue_name
      AND attempts < max_attempts
    ORDER BY run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_job_id IS NOT NULL THEN
        UPDATE public.jobs
        SET status     = 'processing',
            locked_at  = NOW(),
            locked_by  = COALESCE(worker_id, 'worker'),
            attempts   = attempts + 1,
            updated_at = NOW()
        WHERE id = v_job_id;

        RETURN QUERY SELECT * FROM public.jobs WHERE id = v_job_id;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.next_job(text, text) IS
    'Atomically claims the next pending job for the given queue (jobs.name). '
    'Uses FOR UPDATE SKIP LOCKED so multiple workers can poll safely. '
    'Callable only by the service role — never by anon/authenticated users.';

-- Workers connect with the service-role key, which bypasses these grants.
-- Public/authenticated callers must never be able to claim jobs.
REVOKE ALL ON FUNCTION public.next_job(text, text) FROM PUBLIC;

COMMIT;

-- =====================================================================
-- DONE. Verify:
--   SELECT routine_name, specific_name
--   FROM information_schema.routines
--   WHERE routine_schema='public' AND routine_name='next_job';
-- =====================================================================


-- ============================================================================
-- migration: 20260804000000_institutions_status_column.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — ADD institutions.status (IDEMPOTENT)
-- =====================================================================
-- `institutions.status` is declared in the initial schema, but that table is
-- created with CREATE TABLE IF NOT EXISTS. On a database where the table
-- already existed, the IF NOT EXISTS guard skips the statement entirely, so a
-- column added to the definition later never reaches the live table.
--
-- The result was a database whose institutions table had every column except
-- `status`, and any query selecting it failed with
--     42703: column institutions.status does not exist
--
-- Column additions therefore need their own ALTER, which is what this does.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + a guarded constraint.
-- =====================================================================

BEGIN;

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Add the CHECK only when absent. On a database created fresh from the initial
-- schema the constraint already exists under this name, and re-adding it would
-- error.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.institutions'::regclass
          AND conname  = 'institutions_status_check'
    ) THEN
        ALTER TABLE public.institutions
            ADD CONSTRAINT institutions_status_check
            CHECK (status IN ('pending', 'verified', 'suspended', 'rejected'));
    END IF;
END
$$;

-- Backfill: rows that were already flagged verified predate the status column,
-- and would otherwise all read as 'pending'.
UPDATE public.institutions
SET    status = 'verified'
WHERE  verified IS TRUE
  AND  status = 'pending';

COMMIT;

-- =====================================================================
-- DONE. Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='institutions';
-- =====================================================================


-- ============================================================================
-- migration: 20260805000000_retention_enforcement.sql
-- ============================================================================

-- =====================================================================
-- ACREDIA-STELLAR — RETENTION ENFORCEMENT (IDEMPOTENT)
-- Issue #227: retention was promised in the privacy policy but never ran
-- =====================================================================
-- Before this migration, `purge_old_verification_logs()` existed but nothing
-- ever called it: the only schedule was a commented-out `cron.schedule(...)`
-- snippet in the header of 20260801000000_gdpr_erasure.sql, to be pasted into
-- the SQL editor by hand. Meanwhile /legal/privacy told users verification
-- logs were purged by an "automatic nightly purge", and contact messages
-- "24 months from last correspondence". Neither was enforced.
--
-- What this file does:
--   1. Adds `maintenance_runs` — an audit trail of every retention run
--      (when, how long, how many rows, success or failure). GDPR Art. 5(2)
--      requires the controller to *demonstrate* compliance, which a silent
--      job cannot do.
--   2. Adds `purge_old_contact_messages()` — enforces the 24-month policy
--      that was already published but had no mechanism at all.
--   3. Adds `run_retention_purge()` — the single entry point. Runs both
--      purges and records the outcome. Called by /api/cron/retention
--      (Vercel Cron) and, where the extension exists, by pg_cron.
--   4. Adds `retention_status()` — what the admin console reads to show row
--      counts, overdue rows, and when the purge last succeeded.
--   5. Schedules the job via pg_cron *if that extension is available*, so a
--      Supabase-only deployment is covered without Vercel.
--
-- Retention periods are defined in exactly two places per table — the purge
-- function and the status function — and `tests/sqlMigrations.test.ts` asserts
-- they still agree, so they cannot silently drift apart.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- Maintenance run log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_runs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job           TEXT NOT NULL,
    started_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMP WITH TIME ZONE,
    duration_ms   INTEGER,
    rows_deleted  INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'succeeded', 'failed')),
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
    error         TEXT
);

COMMENT ON TABLE public.maintenance_runs IS
    'Audit trail for scheduled maintenance jobs (currently data retention). '
    'Exists so the retention policy published at /legal/privacy can be '
    'demonstrated rather than merely asserted (GDPR Art. 5(2)).';

CREATE INDEX IF NOT EXISTS idx_maintenance_runs_job_finished
    ON public.maintenance_runs (job, status, finished_at DESC);

ALTER TABLE IF EXISTS public.maintenance_runs ENABLE ROW LEVEL SECURITY;

-- Read: admins only. There is deliberately no INSERT/UPDATE policy — rows are
-- written solely by run_retention_purge() (SECURITY DEFINER) and the
-- service-role client, both of which bypass RLS.
DROP POLICY IF EXISTS "Admin can view maintenance runs" ON public.maintenance_runs;
CREATE POLICY "Admin can view maintenance runs"
    ON public.maintenance_runs FOR SELECT
    USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Function: purge_old_contact_messages()
-- The privacy policy states "24 months from last correspondence", so the
-- clock starts at handled_at when the message has been dealt with and at
-- created_at when it never was.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_contact_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.contact_messages
    WHERE COALESCE(handled_at, created_at) < NOW() - INTERVAL '24 months';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_contact_messages() FROM PUBLIC;

COMMENT ON TABLE public.contact_messages IS
    'Submissions from the public /contact form. Written server-side only '
    '(service_role) after validation + rate limiting; readable by admins only. '
    'ip_hash is an HMAC of the client IP — never a raw address. '
    'Retention policy: deleted 24 months after the last correspondence '
    '(handled_at, falling back to created_at) by '
    'public.purge_old_contact_messages(), run nightly via '
    'public.run_retention_purge().';

-- ---------------------------------------------------------------------
-- Function: run_retention_purge()
-- The single entry point for every scheduler. Records the run either way,
-- so a failure is visible instead of silent.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_retention_purge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run_id     uuid;
    v_started    timestamptz := clock_timestamp();
    v_logs       integer := 0;
    v_messages   integer := 0;
    v_duration   integer;
BEGIN
    INSERT INTO public.maintenance_runs (job) VALUES ('retention')
    RETURNING id INTO v_run_id;

    -- Nested block so the failure record below survives: an exception handler
    -- rolls back to the start of its own block, and the INSERT above is
    -- outside it.
    BEGIN
        v_logs     := public.purge_old_verification_logs();
        v_messages := public.purge_old_contact_messages();
    EXCEPTION WHEN OTHERS THEN
        UPDATE public.maintenance_runs
        SET status      = 'failed',
            finished_at = NOW(),
            duration_ms = (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer,
            error       = SQLERRM
        WHERE id = v_run_id;

        -- Returned rather than re-raised: re-raising would roll the failure
        -- record back with it, which is precisely the silence this issue is
        -- about. The caller turns a 'failed' status into a non-200 response.
        RETURN jsonb_build_object(
            'status', 'failed',
            'runId',  v_run_id,
            'error',  SQLERRM
        );
    END;

    v_duration := (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer;

    UPDATE public.maintenance_runs
    SET status       = 'succeeded',
        finished_at  = NOW(),
        duration_ms  = v_duration,
        rows_deleted = v_logs + v_messages,
        detail       = jsonb_build_object(
                           'verification_logs', v_logs,
                           'contact_messages',  v_messages
                       )
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
        'status',            'succeeded',
        'runId',             v_run_id,
        'rowsDeleted',       v_logs + v_messages,
        'verificationLogs',  v_logs,
        'contactMessages',   v_messages,
        'durationMs',        v_duration
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_retention_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_retention_purge() TO service_role;

-- ---------------------------------------------------------------------
-- Function: retention_status()
-- Powers the admin console panel and the staleness alert. `overdue` is the
-- number of rows that should already have been deleted — it must be 0 on a
-- healthy deployment, which is the check that proves the policy is honoured.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retention_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status jsonb;
BEGIN
    SELECT jsonb_build_object(
        'verificationLogs', jsonb_build_object(
            'total',         (SELECT COUNT(*) FROM public.verification_logs),
            'overdue',       (SELECT COUNT(*) FROM public.verification_logs
                              WHERE created_at < NOW() - INTERVAL '90 days'),
            'oldest',        (SELECT MIN(created_at) FROM public.verification_logs),
            'retentionDays', 90
        ),
        'contactMessages', jsonb_build_object(
            'total',           (SELECT COUNT(*) FROM public.contact_messages),
            'overdue',         (SELECT COUNT(*) FROM public.contact_messages
                                WHERE COALESCE(handled_at, created_at)
                                      < NOW() - INTERVAL '24 months'),
            'oldest',          (SELECT MIN(created_at) FROM public.contact_messages),
            'retentionMonths', 24
        ),
        'lastSuccess', (
            SELECT jsonb_build_object(
                'finishedAt',  finished_at,
                'rowsDeleted', rows_deleted,
                'durationMs',  duration_ms,
                'detail',      detail
            )
            FROM public.maintenance_runs
            WHERE job = 'retention' AND status = 'succeeded'
            ORDER BY finished_at DESC
            LIMIT 1
        ),
        'lastFailure', (
            SELECT jsonb_build_object('finishedAt', finished_at, 'error', error)
            FROM public.maintenance_runs
            WHERE job = 'retention' AND status = 'failed'
            ORDER BY finished_at DESC
            LIMIT 1
        )
    ) INTO v_status;

    RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.retention_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retention_status() TO service_role;

-- ---------------------------------------------------------------------
-- Correct the retention annotation on verification_logs.
-- The previous text claimed the purge was "scheduled via pg_cron"; nothing
-- was scheduled anywhere.
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.verification_logs IS
    'Privacy-safe audit log for public verification attempts. '
    'Stores coarse outcomes and hashed request identifiers only — no PII. '
    'Retention policy: rows older than 90 days are deleted by '
    'public.purge_old_verification_logs(), run nightly through '
    'public.run_retention_purge() — invoked by the /api/cron/retention route '
    '(Vercel Cron) and by pg_cron where that extension is available. '
    'Every run is recorded in public.maintenance_runs.';

-- ---------------------------------------------------------------------
-- Schedule via pg_cron when the extension is present.
--
-- Supabase projects can enable pg_cron; plain Postgres and local dev
-- generally cannot. This block therefore no-ops rather than failing the
-- migration, and the /api/cron/retention route covers deployments where it
-- does nothing. Re-running is safe: an existing job is unscheduled first.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'acredia-retention-purge') THEN
            PERFORM cron.unschedule('acredia-retention-purge');
        END IF;

        PERFORM cron.schedule(
            'acredia-retention-purge',
            '0 3 * * *',
            $cron$ SELECT public.run_retention_purge(); $cron$
        );

        RAISE NOTICE 'Retention purge scheduled with pg_cron (03:00 UTC daily).';
    ELSE
        RAISE NOTICE 'pg_cron not installed; retention runs via the /api/cron/retention route.';
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Insufficient privileges on a managed instance, for example. The HTTP
    -- scheduler still covers this deployment, so never fail the migration.
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$$;

COMMIT;

-- =====================================================================
-- DONE. Verify:
--   SELECT public.retention_status();
--
--   -- Must return 0 on a compliant deployment:
--   SELECT COUNT(*) FROM public.verification_logs
--   WHERE created_at < NOW() - INTERVAL '90 days';
--
--   -- Force a run now (service_role):
--   SELECT public.run_retention_purge();
-- =====================================================================


-- ============================================================================
-- migration: 20260806000000_poc_handover_and_audit.sql
-- ============================================================================

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
INSERT INTO public.institution_users (institution_id, auth_user_id, role, is_active)
SELECT id, auth_user_id, 'poc', true
FROM public.institutions
WHERE auth_user_id IS NOT NULL
ON CONFLICT (institution_id, auth_user_id) DO NOTHING;

COMMIT;



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
    );

COMMIT;

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
ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_auth_user_id_fkey;

ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.institutions
    ALTER COLUMN auth_user_id DROP NOT NULL;

COMMENT ON COLUMN public.institutions.auth_user_id IS
    'DEPRECATED (Issue #238): superseded by public.institution_users. Retained nullable and unread so the membership migration stays reversible; a later migration drops it. Do not add new reads.';

COMMIT;

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

-- An institution carrying a provisioning admin was created through the console
-- (Issue #240). Everything else predates that and came from public signup.
UPDATE public.institutions
SET provisioning_origin = 'admin'
WHERE provisioning_origin IS NULL
  AND created_by_admin_id IS NOT NULL;

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
    );

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
