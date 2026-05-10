-- Scalable enterprise dashboard usage summaries.
--
-- Keep project_access_logs as the durable evidence stream, but maintain a
-- compact daily rollup so dashboard overview calls do not count raw traffic
-- rows on every page load.

CREATE TABLE IF NOT EXISTS public.project_access_log_daily_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  day date NOT NULL,
  provider text NOT NULL,
  slug text NOT NULL,
  status_bucket text NOT NULL CHECK (status_bucket IN ('success', 'error', 'denied')),
  call_count bigint NOT NULL DEFAULT 0,
  total_latency_ms bigint NOT NULL DEFAULT 0,
  max_latency_ms integer NOT NULL DEFAULT 0,
  last_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, day, provider, slug, status_bucket)
);

CREATE INDEX IF NOT EXISTS project_access_log_daily_rollups_project_day_idx
  ON public.project_access_log_daily_rollups (project_id, day DESC);

CREATE INDEX IF NOT EXISTS project_access_log_daily_rollups_project_bucket_idx
  ON public.project_access_log_daily_rollups (project_id, status_bucket, day DESC);

ALTER TABLE public.project_access_log_daily_rollups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_access_log_daily_rollups_select_member ON public.project_access_log_daily_rollups;
CREATE POLICY project_access_log_daily_rollups_select_member
  ON public.project_access_log_daily_rollups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_access_log_daily_rollups.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = project_access_log_daily_rollups.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.project_access_log_status_bucket(status_code integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN status_code IN (401, 403, 429) THEN 'denied'
    WHEN status_code >= 400 THEN 'error'
    ELSE 'success'
  END
$$;

CREATE OR REPLACE FUNCTION public.rollup_project_access_log_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bucket text;
  log_day date;
  latency integer;
BEGIN
  bucket := public.project_access_log_status_bucket(NEW.status_code);
  log_day := (NEW.timestamp AT TIME ZONE 'UTC')::date;
  latency := greatest(coalesce(NEW.latency_ms, 0), 0);

  INSERT INTO public.project_access_log_daily_rollups (
    project_id,
    day,
    provider,
    slug,
    status_bucket,
    call_count,
    total_latency_ms,
    max_latency_ms,
    last_timestamp
  )
  VALUES (
    NEW.project_id,
    log_day,
    NEW.provider,
    NEW.slug,
    bucket,
    1,
    latency,
    latency,
    NEW.timestamp
  )
  ON CONFLICT (project_id, day, provider, slug, status_bucket)
  DO UPDATE SET
    call_count = public.project_access_log_daily_rollups.call_count + 1,
    total_latency_ms = public.project_access_log_daily_rollups.total_latency_ms + EXCLUDED.total_latency_ms,
    max_latency_ms = greatest(public.project_access_log_daily_rollups.max_latency_ms, EXCLUDED.max_latency_ms),
    last_timestamp = greatest(public.project_access_log_daily_rollups.last_timestamp, EXCLUDED.last_timestamp),
    updated_at = now();

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS project_access_logs_daily_rollup_insert ON public.project_access_logs;
CREATE TRIGGER project_access_logs_daily_rollup_insert
  AFTER INSERT ON public.project_access_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.rollup_project_access_log_insert();

INSERT INTO public.project_access_log_daily_rollups (
  project_id,
  day,
  provider,
  slug,
  status_bucket,
  call_count,
  total_latency_ms,
  max_latency_ms,
  last_timestamp
)
SELECT
  project_id,
  (timestamp AT TIME ZONE 'UTC')::date AS day,
  provider,
  slug,
  public.project_access_log_status_bucket(status_code) AS status_bucket,
  count(*) AS call_count,
  sum(greatest(coalesce(latency_ms, 0), 0)) AS total_latency_ms,
  max(greatest(coalesce(latency_ms, 0), 0)) AS max_latency_ms,
  max(timestamp) AS last_timestamp
FROM public.project_access_logs
GROUP BY
  project_id,
  (timestamp AT TIME ZONE 'UTC')::date,
  provider,
  slug,
  public.project_access_log_status_bucket(status_code)
ON CONFLICT (project_id, day, provider, slug, status_bucket)
DO UPDATE SET
  call_count = EXCLUDED.call_count,
  total_latency_ms = EXCLUDED.total_latency_ms,
  max_latency_ms = EXCLUDED.max_latency_ms,
  last_timestamp = EXCLUDED.last_timestamp,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.enterprise_project_access_overview(
  project_ids uuid[],
  health_window_since timestamptz DEFAULT now() - interval '7 days',
  recent_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH project_filter AS (
    SELECT unnest(coalesce(project_ids, ARRAY[]::uuid[])) AS project_id
  ),
  rollups AS (
    SELECT r.*
    FROM public.project_access_log_daily_rollups r
    JOIN project_filter p ON p.project_id = r.project_id
  ),
  totals AS (
    SELECT
      coalesce(sum(call_count), 0)::bigint AS total_calls,
      coalesce(sum(call_count) FILTER (WHERE status_bucket IN ('error', 'denied')), 0)::bigint AS error_calls,
      coalesce(sum(call_count) FILTER (WHERE status_bucket = 'denied'), 0)::bigint AS denied_calls
    FROM rollups
  ),
  health AS (
    SELECT
      project_id,
      coalesce(sum(call_count), 0)::bigint AS calls,
      coalesce(sum(call_count) FILTER (WHERE status_bucket IN ('error', 'denied')), 0)::bigint AS errors,
      coalesce(sum(call_count) FILTER (WHERE status_bucket = 'denied'), 0)::bigint AS denied,
      max(last_timestamp) AS last_activity
    FROM rollups
    WHERE day >= (health_window_since AT TIME ZONE 'UTC')::date
    GROUP BY project_id
  ),
  recent AS (
    SELECT
      l.id,
      l.project_id,
      l.project_key_id,
      l.provider,
      l.slug,
      l.method,
      l.upstream_path,
      l.status_code,
      l.latency_ms,
      l.timestamp,
      l.metadata
    FROM public.project_access_logs l
    JOIN project_filter p ON p.project_id = l.project_id
    ORDER BY l.timestamp DESC
    LIMIT least(greatest(coalesce(recent_limit, 20), 1), 100)
  )
  SELECT jsonb_build_object(
    'total_calls', totals.total_calls,
    'error_calls', totals.error_calls,
    'denied_calls', totals.denied_calls,
    'project_health', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'project_id', h.project_id,
          'calls', h.calls,
          'errors', h.errors,
          'denied', h.denied,
          'last_activity', h.last_activity
        )
        ORDER BY h.denied DESC, h.errors DESC, h.calls DESC, h.project_id
      )
      FROM health h
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      SELECT jsonb_agg(to_jsonb(recent.*) ORDER BY recent.timestamp DESC)
      FROM recent
    ), '[]'::jsonb)
  )
  FROM totals;
$$;

GRANT SELECT ON public.project_access_log_daily_rollups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_access_log_daily_rollups TO service_role;
REVOKE EXECUTE ON FUNCTION public.project_access_log_status_bucket(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_access_log_status_bucket(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_access_log_status_bucket(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rollup_project_access_log_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rollup_project_access_log_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rollup_project_access_log_insert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enterprise_project_access_overview(uuid[], timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enterprise_project_access_overview(uuid[], timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enterprise_project_access_overview(uuid[], timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_project_access_overview(uuid[], timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
