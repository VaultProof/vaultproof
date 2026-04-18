-- Init proxy call logs for project-based dashboard usage.
-- Records one row per proxied upstream call made via vp-proj-*.

CREATE TABLE IF NOT EXISTS public.project_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  project_key_id uuid NOT NULL REFERENCES public.project_keys(id) ON DELETE CASCADE,
  slug text NOT NULL,
  provider text NOT NULL,
  method text NOT NULL,
  upstream_path text NOT NULL,
  status_code integer NOT NULL,
  latency_ms integer NOT NULL,
  error text,
  metadata jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_access_logs_project_id_ts_idx
  ON public.project_access_logs (project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS project_access_logs_project_key_id_ts_idx
  ON public.project_access_logs (project_key_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS project_access_logs_slug_ts_idx
  ON public.project_access_logs (slug, timestamp DESC);

ALTER TABLE public.project_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_access_logs_select_own ON public.project_access_logs;
CREATE POLICY project_access_logs_select_own
  ON public.project_access_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_access_logs.project_id
        AND p.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.project_access_logs TO authenticated;
GRANT SELECT, INSERT ON public.project_access_logs TO service_role;
