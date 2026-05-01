-- Expand enterprise IAM beyond viewer/member/admin/owner while preserving legacy roles.

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN (
    'owner',
    'admin',
    'iam_admin',
    'security_admin',
    'platform_admin',
    'developer',
    'auditor',
    'member',
    'viewer'
  ));

ALTER TABLE public.organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_role_check;

ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_role_check
  CHECK (role IN (
    'owner',
    'admin',
    'iam_admin',
    'security_admin',
    'platform_admin',
    'developer',
    'auditor',
    'member',
    'viewer'
  ));

ALTER TABLE public.project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN (
    'owner',
    'admin',
    'project_admin',
    'operator',
    'developer',
    'auditor',
    'member',
    'viewer'
  ));

DROP POLICY IF EXISTS organization_members_select_visible ON public.organization_members;
CREATE POLICY organization_members_select_visible
  ON public.organization_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'iam_admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

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
        AND pm.role IN ('owner', 'admin', 'project_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.organization_members om
        ON om.organization_id = p.organization_id
      WHERE p.id = project_members.project_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'iam_admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

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
        AND om.role IN ('owner', 'admin', 'iam_admin', 'security_admin', 'platform_admin', 'auditor')
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
        AND pm.role IN ('owner', 'admin', 'project_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.organization_members om
        ON om.organization_id = p.organization_id
      WHERE p.id = project_keys.project_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'security_admin', 'platform_admin')
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
        AND om.role IN ('owner', 'admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );
