-- VaultProof employee business status history for internal admin.
--
-- Goal:
-- Let VaultProof employees track onboarding/go-live/support status without
-- changing customer-owned organization records directly.

CREATE TABLE IF NOT EXISTS public.internal_admin_business_status_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('onboarding', 'active', 'at_risk', 'paused', 'offboarding')),
  plan_label text,
  summary text NOT NULL,
  next_step text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_admin_business_status_updates_org_created_idx
  ON public.internal_admin_business_status_updates (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS internal_admin_business_status_updates_status_created_idx
  ON public.internal_admin_business_status_updates (status, created_at DESC);

ALTER TABLE public.internal_admin_business_status_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_admin_business_status_updates_no_customer_access
  ON public.internal_admin_business_status_updates;
CREATE POLICY internal_admin_business_status_updates_no_customer_access
  ON public.internal_admin_business_status_updates
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.internal_admin_business_status_updates FROM anon;
REVOKE ALL ON TABLE public.internal_admin_business_status_updates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_admin_business_status_updates TO service_role;
