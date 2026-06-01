-- Enterprise proxy access tiers.
-- These controls make leaked vp-proj-* identifiers insufficient by themselves
-- for organization-backed Enterprise traffic.

CREATE TABLE IF NOT EXISTS public.organization_proxy_access_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'basic',
  enforcement_mode text NOT NULL DEFAULT 'monitor',
  allowed_egress_cidrs text[] NOT NULL DEFAULT '{}',
  require_mtls boolean NOT NULL DEFAULT false,
  require_private_connectivity boolean NOT NULL DEFAULT false,
  anomaly_auto_freeze_enabled boolean NOT NULL DEFAULT true,
  default_rate_limit_per_minute integer,
  default_provider_scope_mode text NOT NULL DEFAULT 'project_policy',
  freeze_state text NOT NULL DEFAULT 'active',
  freeze_reason text,
  frozen_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_proxy_access_policies_tier_check
    CHECK (tier IN ('basic', 'recommended', 'high_security')),
  CONSTRAINT organization_proxy_access_policies_enforcement_mode_check
    CHECK (enforcement_mode IN ('monitor', 'enforce', 'paused')),
  CONSTRAINT organization_proxy_access_policies_scope_mode_check
    CHECK (default_provider_scope_mode IN ('project_policy', 'deny_unscoped')),
  CONSTRAINT organization_proxy_access_policies_freeze_state_check
    CHECK (freeze_state IN ('active', 'frozen', 'thaw_pending')),
  CONSTRAINT organization_proxy_access_policies_rate_limit_check
    CHECK (
      default_rate_limit_per_minute IS NULL
      OR (default_rate_limit_per_minute >= 1 AND default_rate_limit_per_minute <= 60000)
    )
);

ALTER TABLE public.organization_proxy_access_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_proxy_access_policies_select_member
  ON public.organization_proxy_access_policies;
CREATE POLICY organization_proxy_access_policies_select_member
  ON public.organization_proxy_access_policies
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_proxy_access_policies.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'iam_admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_proxy_access_policies TO service_role;
GRANT SELECT ON public.organization_proxy_access_policies TO authenticated;

