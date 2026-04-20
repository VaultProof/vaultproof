-- B2B / enterprise foundation.
--
-- Goal:
-- Introduce an organization + membership model without breaking the current
-- single-user `projects.user_id` flow used by the init worker today.
--
-- Important:
-- - `projects.user_id` remains in place for compatibility.
-- - `projects.organization_id` starts nullable so existing worker inserts do not
--   break before the API layer is updated.
-- - Existing projects are backfilled into one personal org per user.

-- ── organizations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  kind text NOT NULL DEFAULT 'team' CHECK (kind IN ('personal', 'team')),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_owner_user_id_idx
  ON public.organizations (owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_lower_uidx
  ON public.organizations (lower(slug))
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_personal_owner_uidx
  ON public.organizations (owner_user_id)
  WHERE kind = 'personal';

-- ── organization_members ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_id_idx
  ON public.organization_members (user_id);

CREATE INDEX IF NOT EXISTS organization_members_org_role_idx
  ON public.organization_members (organization_id, role);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member
  ON public.organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS organizations_insert_owner ON public.organizations;
CREATE POLICY organizations_insert_owner
  ON public.organizations
  FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS organizations_update_owner ON public.organizations;
CREATE POLICY organizations_update_owner
  ON public.organizations
  FOR UPDATE
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS organizations_delete_owner ON public.organizations;
CREATE POLICY organizations_delete_owner
  ON public.organizations
  FOR DELETE
  USING (auth.uid() = owner_user_id);

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
        AND om.role IN ('owner', 'admin')
    )
  );

-- Writes will primarily happen through service_role until the new dashboard
-- and API surfaces are in place.

-- ── projects organization scope (non-breaking) ─────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_organization_id_idx
  ON public.projects (organization_id);

-- ── backfill: create one personal org per existing project owner ───────────
INSERT INTO public.organizations (name, kind, owner_user_id)
SELECT 'Personal', 'personal', src.user_id
FROM (
  SELECT DISTINCT user_id
  FROM public.projects
) AS src
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organizations o
  WHERE o.owner_user_id = src.user_id
    AND o.kind = 'personal'
);

-- Every organization needs its owner membership row.
INSERT INTO public.organization_members (organization_id, user_id, role, invited_by)
SELECT o.id, o.owner_user_id, 'owner', o.owner_user_id
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organization_members om
  WHERE om.organization_id = o.id
    AND om.user_id = o.owner_user_id
);

-- Backfill current projects into each user's personal organization.
UPDATE public.projects p
SET organization_id = o.id
FROM public.organizations o
WHERE p.organization_id IS NULL
  AND o.owner_user_id = p.user_id
  AND o.kind = 'personal';

-- ── grants ──────────────────────────────────────────────────────────────────
GRANT SELECT ON public.organizations TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO service_role;
