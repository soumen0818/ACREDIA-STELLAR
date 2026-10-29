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
--      way, so policies see exactly what they see in production.

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
            current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
        ),
        ''
    )::uuid
$$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(
        coalesce(
            current_setting('request.jwt.claim.role', true),
            current_setting('request.jwt.claims', true)::jsonb ->> 'role'
        ),
        ''
    )::text
$$;

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;
