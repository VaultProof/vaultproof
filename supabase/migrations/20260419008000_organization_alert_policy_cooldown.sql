ALTER TABLE public.organization_alert_policies
  ADD COLUMN IF NOT EXISTS min_interval_minutes integer NOT NULL DEFAULT 60
  CHECK (min_interval_minutes >= 5 AND min_interval_minutes <= 10080);
