-- Minimal stand-in for what a Supabase project provides before any
-- migration runs, so supabase/schema.sql can be applied to plain Postgres
-- for the RLS tests in tests/rls/.
--
-- Two things must match Supabase for the tests to mean anything:
--
--   1. The default privileges. Supabase grants ALL on public tables to
--      anon, authenticated and service_role and relies on RLS to restrict
--      access. Without these grants every "denied" test would pass for the
--      wrong reason (missing grant instead of policy/revoke).
--   2. auth.uid() / auth.role() / auth.jwt(), which read the JWT claims
--      PostgREST sets per request. Tests set `request.jwt.claims` the same
--      way, so policies see exactly what they see in production. Like
--      Supabase's own definitions, they treat an empty setting as absent:
--      once a session has set the claims, later transactions see '' rather
--      than NULL, and casting '' to jsonb would fail.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
    id                 uuid PRIMARY KEY,
    email              text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
    created_at         timestamptz DEFAULT now(),
    email_confirmed_at timestamptz,
    deleted_at         timestamptz
);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(
        coalesce(
            current_setting('request.jwt.claim.sub', true),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        ),
        ''
    )::uuid
$$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(
        coalesce(
            current_setting('request.jwt.claim.role', true),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
        ),
        ''
    )::text
$$;

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- Supabase Storage. Like Supabase, storage.objects has RLS enabled and
-- client roles hold table privileges, so access depends only on policies:
-- a bucket with no policies is readable and writable by the service role
-- alone.
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
    id                 text PRIMARY KEY,
    name               text NOT NULL,
    owner              uuid,
    public             boolean DEFAULT false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz DEFAULT now(),
    updated_at         timestamptz DEFAULT now()
);

CREATE TABLE storage.objects (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id  text REFERENCES storage.buckets (id),
    name       text,
    owner      uuid,
    metadata   jsonb,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;
