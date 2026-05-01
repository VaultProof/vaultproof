-- VaultProof employee execution/rollback records for destructive action requests.
--
-- Goal:
-- Before any dangerous employee action is executed, store a durable dry-run
-- execution plan with preflight checks and rollback material. Real execution
-- should only be enabled after this record type is reviewed and operationalized.

CREATE TABLE IF NOT EXISTS public.internal_admin_action_execution_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_request_id uuid NOT NULL REFERENCES public.internal_admin_action_requests(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('disable_org_access')),
  execution_mode text NOT NULL DEFAULT 'dry_run' CHECK (execution_mode IN ('dry_run', 'live')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'executed', 'rolled_back', 'failed')),
  execution_enabled boolean NOT NULL DEFAULT false,
  preflight_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_by_email text NOT NULL,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_admin_action_execution_records_request_created_idx
  ON public.internal_admin_action_execution_records (action_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS internal_admin_action_execution_records_org_created_idx
  ON public.internal_admin_action_execution_records (organization_id, created_at DESC);

ALTER TABLE public.internal_admin_action_execution_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_admin_action_execution_records_no_customer_access
  ON public.internal_admin_action_execution_records;
CREATE POLICY internal_admin_action_execution_records_no_customer_access
  ON public.internal_admin_action_execution_records
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.internal_admin_action_execution_records FROM anon;
REVOKE ALL ON TABLE public.internal_admin_action_execution_records FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_admin_action_execution_records TO service_role;
