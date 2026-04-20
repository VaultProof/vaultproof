CREATE TABLE IF NOT EXISTS public.organization_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.organization_alert_destinations(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('email', 'webhook')),
  status text NOT NULL CHECK (status IN ('delivered', 'failed', 'skipped')),
  detail text NOT NULL,
  response_status integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_alert_deliveries_org_idx
  ON public.organization_alert_deliveries (organization_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS organization_alert_deliveries_destination_idx
  ON public.organization_alert_deliveries (destination_id, delivered_at DESC);
