-- VaultProof employee approval workflow for destructive internal admin actions.
--
-- Goal:
-- Do not execute dangerous customer-impacting actions directly from the
-- employee console. First create a request, require a second employee to
-- approve/reject it, then wire execution separately with rollback evidence.

CREATE TABLE IF NOT EXISTS public.internal_admin_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('disable_org_access')),
  risk_level text NOT NULL DEFAULT 'high' CHECK (risk_level IN ('medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'cancelled')),
  reason text NOT NULL,
  requested_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_email text NOT NULL,
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_email text,
  approved_at timestamptz,
  rejected_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_by_email text,
  rejected_at timestamptz,
  executed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_by_email text,
  executed_at timestamptz,
  decision_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_admin_action_requests_org_created_idx
  ON public.internal_admin_action_requests (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS internal_admin_action_requests_status_created_idx
  ON public.internal_admin_action_requests (status, created_at DESC);

ALTER TABLE public.internal_admin_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_admin_action_requests_no_customer_access
  ON public.internal_admin_action_requests;
CREATE POLICY internal_admin_action_requests_no_customer_access
  ON public.internal_admin_action_requests
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.internal_admin_action_requests FROM anon;
REVOKE ALL ON TABLE public.internal_admin_action_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_admin_action_requests TO service_role;
