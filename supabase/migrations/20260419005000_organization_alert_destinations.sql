CREATE TABLE IF NOT EXISTS public.organization_alert_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('email', 'webhook')),
  label text NOT NULL,
  target text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_alert_destinations_org_idx
  ON public.organization_alert_destinations (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS organization_alert_destinations_org_channel_target_uidx
  ON public.organization_alert_destinations (organization_id, channel_type, lower(target));
