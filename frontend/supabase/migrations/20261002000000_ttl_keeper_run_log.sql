-- Durable cursor and operator evidence for the daily credential TTL keeper.
CREATE TABLE IF NOT EXISTS public.cron_run_log (
    run_id uuid PRIMARY KEY,
    job_name text NOT NULL,
    status text NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed')),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cron_run_log_job_completed_idx
    ON public.cron_run_log (job_name, completed_at DESC);
ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_run_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.cron_run_log TO service_role;
COMMENT ON TABLE public.cron_run_log IS
    'Server-only keeper run summaries and cursor. Monitor missing or partial runs independently of the cron.';

CREATE TABLE IF NOT EXISTS public.ttl_keeper_lock (
    job_name text PRIMARY KEY,
    owner_run_id uuid,
    locked_until timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ttl_keeper_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ttl_keeper_lock FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ttl_keeper_lock TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ttl_keeper_lock(p_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE updated_count integer;
BEGIN
    INSERT INTO public.ttl_keeper_lock(job_name) VALUES ('ttl-keeper')
    ON CONFLICT (job_name) DO NOTHING;
    UPDATE public.ttl_keeper_lock
       SET owner_run_id = p_run_id, locked_until = now() + interval '6 minutes'
     WHERE job_name = 'ttl-keeper' AND locked_until <= now();
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;
CREATE OR REPLACE FUNCTION public.release_ttl_keeper_lock(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
    UPDATE public.ttl_keeper_lock SET owner_run_id = NULL, locked_until = now()
    WHERE job_name = 'ttl-keeper' AND owner_run_id = p_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ttl_keeper_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ttl_keeper_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ttl_keeper_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ttl_keeper_lock(uuid) TO service_role;
