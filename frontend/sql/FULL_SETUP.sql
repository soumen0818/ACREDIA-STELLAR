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
    auth_user_id          UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    email                 TEXT UNIQUE NOT NULL,
    wallet_address        TEXT UNIQUE,
    verified              BOOLEAN DEFAULT false,
    authorization_tx_hash TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Students
CREATE TABLE IF NOT EXISTS public.students (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    auth_user_id   UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Credentials
CREATE TABLE IF NOT EXISTS public.credentials (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    student_id              UUID REFERENCES public.students (id) ON DELETE CASCADE,
    student_wallet_address  TEXT,
    institution_id          UUID REFERENCES public.institutions (id) ON DELETE CASCADE,
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

COMMENT ON TABLE public.verification_logs IS
    'Privacy-safe audit log for public verification attempts. Store coarse outcomes and hashed request identifiers only.';

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

-- ---------------------------------------------------------------------
-- Enable Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.institutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_logs ENABLE ROW LEVEL SECURITY;

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

-- ---------------------------------------------------------------------
-- Profiles policies
-- ---------------------------------------------------------------------
CREATE POLICY "Profiles can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Profiles can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admin can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Institutions policies
-- ---------------------------------------------------------------------
CREATE POLICY "Institutions can view own data"
  ON public.institutions FOR SELECT
  USING (auth.uid() = auth_user_id);

CREATE POLICY "Institutions can update own data"
  ON public.institutions FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Institutions can insert own data"
  ON public.institutions FOR INSERT
  WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Authenticated users can read institution names"
  ON public.institutions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can view all institutions"
  ON public.institutions FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admin can update institutions"
  ON public.institutions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Students policies
-- ---------------------------------------------------------------------
CREATE POLICY "Students can view own data"
  ON public.students FOR SELECT
  USING (auth.uid() = auth_user_id);

CREATE POLICY "Students can update own data"
  ON public.students FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Students can insert own data"
  ON public.students FOR INSERT
  WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY "Admin can view all students"
  ON public.students FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admin can update students"
  ON public.students FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------
-- Credentials policies
-- ---------------------------------------------------------------------
CREATE POLICY "Students can view own credentials"
  ON public.credentials FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Institutions can view issued credentials"
  ON public.credentials FOR SELECT
  USING (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Institutions can insert credentials"
  ON public.credentials FOR INSERT
  WITH CHECK (
    institution_id IN (
      SELECT id FROM public.institutions WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Institutions can update own credentials"
  ON public.credentials FOR UPDATE
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

CREATE POLICY "Admin can view all credentials"
  ON public.credentials FOR SELECT
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- Verification logs policies
-- ---------------------------------------------------------------------
CREATE POLICY "Admin can view verification logs"
  ON public.verification_logs FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admin can insert verification logs"
  ON public.verification_logs FOR INSERT
  WITH CHECK (public.is_admin());

COMMIT;

-- =====================================================================
-- DONE. Verify tables exist (optional sanity check):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
-- =====================================================================
