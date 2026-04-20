-- Governance audit stream for org/team actions.
--
-- Goal:
-- Keep a durable event log for membership, invite, policy, and project
-- administration actions, then merge it with project_access_logs in the UI.

CREATE TABLE IF NOT EXISTS public.organization_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_audit_events_org_created_idx
  ON public.organization_audit_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_audit_events_project_created_idx
  ON public.organization_audit_events (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_audit_events_type_created_idx
  ON public.organization_audit_events (event_type, created_at DESC);

ALTER TABLE public.organization_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_audit_events_select_member ON public.organization_audit_events;
CREATE POLICY organization_audit_events_select_member
  ON public.organization_audit_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_audit_events.organization_id
        AND om.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.organization_audit_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_audit_events TO service_role;
