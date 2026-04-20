CREATE TABLE IF NOT EXISTS public.organization_alert_dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trigger_source text NOT NULL CHECK (trigger_source IN ('manual', 'scheduled')),
  status text NOT NULL CHECK (status IN ('dispatched', 'skipped', 'failed')),
  reason text,
  dispatched_alert_count integer NOT NULL DEFAULT 0,
  destination_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  next_eligible_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_alert_dispatch_runs_org_idx
  ON public.organization_alert_dispatch_runs (organization_id, checked_at DESC);
