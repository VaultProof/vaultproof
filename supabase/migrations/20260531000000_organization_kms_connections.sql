-- Enterprise customer-managed KMS onboarding.
--
-- One row belongs to exactly one customer organization. Internal admin writes
-- use the service role, while customer org admins can read their own KMS
-- onboarding status for evidence and handoff.

CREATE TABLE IF NOT EXISTS public.organization_kms_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'aws-kms',
  display_name text,
  status text NOT NULL DEFAULT 'waiting_on_customer',
  aws_account_id text,
  aws_region text,
  aws_kms_key_arn text,
  aws_role_arn text,
  external_id text NOT NULL,
  last_test_status text NOT NULL DEFAULT 'not_tested',
  last_tested_at timestamptz,
  last_test_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_kms_connections_provider_check
    CHECK (provider IN ('aws-kms')),
  CONSTRAINT organization_kms_connections_status_check
    CHECK (status IN ('waiting_on_customer', 'ready_to_test', 'verified', 'blocked')),
  CONSTRAINT organization_kms_connections_test_status_check
    CHECK (last_test_status IN ('not_tested', 'passed', 'failed')),
  CONSTRAINT organization_kms_connections_external_id_check
    CHECK (length(external_id) BETWEEN 16 AND 160),
  CONSTRAINT organization_kms_connections_aws_account_id_check
    CHECK (aws_account_id IS NULL OR aws_account_id ~ '^[0-9]{12}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_kms_connections_org_provider_uidx
  ON public.organization_kms_connections (organization_id, provider);

CREATE INDEX IF NOT EXISTS organization_kms_connections_status_idx
  ON public.organization_kms_connections (status);

CREATE INDEX IF NOT EXISTS organization_kms_connections_aws_account_idx
  ON public.organization_kms_connections (aws_account_id);

ALTER TABLE public.organization_kms_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_kms_connections_select_org_admin
  ON public.organization_kms_connections;
CREATE POLICY organization_kms_connections_select_org_admin
  ON public.organization_kms_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_kms_connections.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'iam_admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

DROP POLICY IF EXISTS organization_kms_connections_no_customer_writes
  ON public.organization_kms_connections;
CREATE POLICY organization_kms_connections_no_customer_writes
  ON public.organization_kms_connections
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON public.organization_kms_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_kms_connections TO service_role;
