CREATE TABLE IF NOT EXISTS public.organization_alert_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  dispatch_enabled boolean NOT NULL DEFAULT false,
  minimum_severity text NOT NULL DEFAULT 'warning' CHECK (minimum_severity IN ('info', 'warning', 'critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_alert_deliveries
  ADD COLUMN IF NOT EXISTS delivery_kind text NOT NULL DEFAULT 'test_send'
  CHECK (delivery_kind IN ('test_send', 'policy_dispatch'));
