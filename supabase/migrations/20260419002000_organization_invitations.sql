-- Organization invitation foundation.
--
-- Goal:
-- Support pending member invites before the full accept/join flow exists.
-- This lets the dashboard and worker expose real invitation state without
-- forcing direct membership creation for users who have not joined yet.

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS organization_invitations_org_status_idx
  ON public.organization_invitations (organization_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_email_uidx
  ON public.organization_invitations (organization_id, lower(email))
  WHERE status = 'pending';

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_invitations_select_visible ON public.organization_invitations;
CREATE POLICY organization_invitations_select_visible
  ON public.organization_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.organization_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO service_role;
