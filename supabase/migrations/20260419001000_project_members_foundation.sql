-- Shared project access foundation.
--
-- Goal:
-- Move from single-owner project access toward team-safe project membership.
-- This migration is additive and does not remove the legacy `projects.user_id`
-- ownership path yet.

-- ── project_members ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_members_user_id_idx
  ON public.project_members (user_id);

CREATE INDEX IF NOT EXISTS project_members_project_role_idx
  ON public.project_members (project_id, role);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_members_select_visible ON public.project_members;
CREATE POLICY project_members_select_visible
  ON public.project_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_members.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.organization_members om
        ON om.organization_id = p.organization_id
      WHERE p.id = project_members.project_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- Backfill the current project owner into project_members.
INSERT INTO public.project_members (project_id, user_id, role, invited_by)
SELECT p.id, p.user_id, 'owner', p.user_id
FROM public.projects p
WHERE p.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p.id
      AND pm.user_id = p.user_id
  );

-- Extend read visibility so future dashboard pages can move to team-safe access.
DROP POLICY IF EXISTS projects_select_member ON public.projects;
CREATE POLICY projects_select_member
  ON public.projects
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = projects.id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = projects.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS project_keys_select_member ON public.project_keys;
CREATE POLICY project_keys_select_member
  ON public.project_keys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_keys.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.organization_members om
        ON om.organization_id = p.organization_id
      WHERE p.id = project_keys.project_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS project_access_logs_select_member ON public.project_access_logs;
CREATE POLICY project_access_logs_select_member
  ON public.project_access_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = project_access_logs.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.organization_members om
        ON om.organization_id = p.organization_id
      WHERE p.id = project_access_logs.project_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

GRANT SELECT ON public.project_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO service_role;
