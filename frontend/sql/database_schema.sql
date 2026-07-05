-- =====================================================================
-- ACREDIA-STELLAR base database schema
-- =====================================================================
-- Prefer FULL_SETUP.sql for a new Supabase project; it includes this base
-- schema plus production RLS policies and compatibility migrations.
-- This file is kept as the focused table/index schema reference.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.profiles (
    id         UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email      TEXT UNIQUE NOT NULL,
    role       TEXT NOT NULL,
    full_name  TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.students (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    auth_user_id   UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_institutions_auth_user       ON public.institutions (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_institutions_wallet          ON public.institutions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_students_auth_user           ON public.students (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_students_wallet              ON public.students (wallet_address);
CREATE INDEX IF NOT EXISTS idx_credentials_student          ON public.credentials (student_id);
CREATE INDEX IF NOT EXISTS idx_credentials_institution      ON public.credentials (institution_id);
CREATE INDEX IF NOT EXISTS idx_credentials_token            ON public.credentials (token_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_credential ON public.verification_logs (credential_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created_at ON public.verification_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_verification_logs_result_type
    ON public.verification_logs ((verification_result->>'result_type'));

ALTER TABLE IF EXISTS public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.institutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_logs ENABLE ROW LEVEL SECURITY;
