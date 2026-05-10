-- Collapse the enterprise Projects page bootstrap into one service-role RPC.
--
-- The browser still validates the Supabase user token through Auth, but the
-- control plane no longer needs separate REST reads for memberships, direct
-- project access, org-wide project access, provider slots, and rollup stats.

CREATE OR REPLACE FUNCTION public.enterprise_projects_bootstrap(
  input_user_id uuid,
  input_organization_id uuid DEFAULT NULL,
  health_window_since timestamptz DEFAULT now() - interval '7 days',
  recent_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH memberships AS (
    SELECT
      om.organization_id,
      o.name AS organization_name,
      o.kind AS organization_kind,
      o.owner_user_id AS organization_owner_user_id,
      om.role AS organization_role,
      om.created_at AS membership_created_at,
      CASE
        WHEN o.kind = 'personal' AND o.owner_user_id = input_user_id THEN 1
        ELSE 0
      END AS personal_rank,
      CASE om.role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'iam_admin' THEN 2
        WHEN 'security_admin' THEN 2
        WHEN 'platform_admin' THEN 2
        WHEN 'project_admin' THEN 2
        WHEN 'developer' THEN 1
        WHEN 'operator' THEN 1
        WHEN 'member' THEN 1
        ELSE 0
      END AS role_rank
    FROM public.organization_members om
    JOIN public.organizations o
      ON o.id = om.organization_id
    WHERE om.user_id = input_user_id
      AND o.archived_at IS NULL
  ),
  ordered_memberships AS (
    SELECT
      memberships.*,
      row_number() OVER (
        ORDER BY personal_rank DESC, role_rank DESC, membership_created_at ASC, organization_id ASC
      ) AS membership_rank
    FROM memberships
  ),
  selected_org AS (
    SELECT organization_id
    FROM ordered_memberships
    WHERE input_organization_id IS NOT NULL
      AND organization_id = input_organization_id
    UNION ALL
    SELECT organization_id
    FROM ordered_memberships
    WHERE membership_rank = 1
      AND input_organization_id IS NULL
    LIMIT 1
  ),
  direct_project_access AS (
    SELECT
      p.id,
      p.organization_id,
      p.vp_proj_id,
      p.name,
      p.allowed_origins,
      p.strict_origin,
      p.caller_lock_policy,
      p.created_at,
      p.revoked_at,
      pm.role AS project_role,
      'project'::text AS access_via,
      CASE pm.role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'project_admin' THEN 2
        WHEN 'operator' THEN 1
        WHEN 'developer' THEN 1
        WHEN 'member' THEN 1
        ELSE 0
      END AS access_rank
    FROM public.project_members pm
    JOIN public.projects p
      ON p.id = pm.project_id
    WHERE pm.user_id = input_user_id
      AND p.revoked_at IS NULL
      AND (
        p.organization_id = (SELECT organization_id FROM selected_org)
        OR (
          (SELECT organization_id FROM selected_org) IS NULL
          AND (
            p.organization_id IS NULL
            OR p.organization_id IN (SELECT organization_id FROM memberships)
          )
        )
      )
  ),
  org_project_access AS (
    SELECT
      p.id,
      p.organization_id,
      p.vp_proj_id,
      p.name,
      p.allowed_origins,
      p.strict_origin,
      p.caller_lock_policy,
      p.created_at,
      p.revoked_at,
      CASE m.organization_role
        WHEN 'owner' THEN 'owner'
        WHEN 'admin' THEN 'admin'
        WHEN 'security_admin' THEN 'admin'
        WHEN 'platform_admin' THEN 'admin'
        WHEN 'auditor' THEN 'viewer'
        ELSE NULL
      END AS project_role,
      'organization'::text AS access_via,
      CASE m.organization_role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'security_admin' THEN 2
        WHEN 'platform_admin' THEN 2
        ELSE 0
      END AS access_rank
    FROM memberships m
    JOIN public.projects p
      ON p.organization_id = m.organization_id
    WHERE (
        m.organization_id = (SELECT organization_id FROM selected_org)
        OR (
          (SELECT organization_id FROM selected_org) IS NULL
          AND input_organization_id IS NOT NULL
        )
      )
      AND m.organization_role IN ('owner', 'admin', 'security_admin', 'platform_admin', 'auditor')
      AND p.revoked_at IS NULL
  ),
  project_access_candidates AS (
    SELECT *
    FROM direct_project_access
    UNION ALL
    SELECT *
    FROM org_project_access
    WHERE project_role IS NOT NULL
  ),
  ranked_projects AS (
    SELECT
      project_access_candidates.*,
      row_number() OVER (
        PARTITION BY id
        ORDER BY access_rank DESC, CASE WHEN access_via = 'project' THEN 1 ELSE 0 END DESC, created_at DESC
      ) AS project_rank
    FROM project_access_candidates
  ),
  accessible_projects AS (
    SELECT
      id,
      organization_id,
      vp_proj_id,
      name,
      allowed_origins,
      strict_origin,
      coalesce(caller_lock_policy, '{}'::jsonb) AS caller_lock_policy,
      created_at,
      revoked_at,
      project_role,
      access_via
    FROM ranked_projects
    WHERE project_rank = 1
  ),
  provider_slots AS (
    SELECT
      pk.project_id,
      jsonb_agg(
        jsonb_build_object(
          'key_id', pk.id,
          'provider', pk.provider,
          'slug', coalesce(pk.slug, pk.provider),
          'material_mode', CASE
            WHEN coalesce(pk.share1_encrypted, '') = '' OR coalesce(pk.share2_encrypted, '') = '' THEN 'missing'
            WHEN pk.share1_encrypted LIKE 'demo-dashboard-placeholder%' AND pk.share2_encrypted LIKE 'demo-dashboard-placeholder%' THEN 'demo-placeholder'
            WHEN pk.share1_encrypted NOT LIKE 'demo-dashboard-placeholder%' AND pk.share2_encrypted NOT LIKE 'demo-dashboard-placeholder%' THEN 'sealed-live'
            ELSE 'mixed'
          END,
          'material_ready', CASE
            WHEN coalesce(pk.share1_encrypted, '') = '' OR coalesce(pk.share2_encrypted, '') = '' THEN false
            WHEN pk.share1_encrypted LIKE 'demo-dashboard-placeholder%' OR pk.share2_encrypted LIKE 'demo-dashboard-placeholder%' THEN false
            ELSE true
          END
        )
        ORDER BY pk.provider, coalesce(pk.slug, pk.provider), pk.id
      ) AS slots
    FROM public.project_keys pk
    JOIN accessible_projects ap
      ON ap.id = pk.project_id
    WHERE pk.revoked_at IS NULL
    GROUP BY pk.project_id
  ),
  project_ids AS (
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) AS ids
    FROM accessible_projects
  ),
  access_overview AS (
    SELECT public.enterprise_project_access_overview(
      (SELECT ids FROM project_ids),
      health_window_since,
      recent_limit
    ) AS payload
  )
  SELECT jsonb_build_object(
    'organizations', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', om.organization_id,
          'name', om.organization_name,
          'kind', om.organization_kind,
          'role', om.organization_role,
          'is_active', om.organization_id = (SELECT organization_id FROM selected_org)
        )
        ORDER BY om.personal_rank DESC, om.role_rank DESC, om.membership_created_at ASC, om.organization_id ASC
      )
      FROM ordered_memberships om
    ), '[]'::jsonb),
    'active_organization_id', (SELECT organization_id FROM selected_org),
    'projects', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ap.id,
          'organization_id', ap.organization_id,
          'vp_proj_id', ap.vp_proj_id,
          'name', ap.name,
          'allowed_origins', ap.allowed_origins,
          'strict_origin', ap.strict_origin,
          'caller_lock_policy', ap.caller_lock_policy,
          'created_at', ap.created_at,
          'revoked_at', ap.revoked_at,
          'project_role', ap.project_role,
          'access_via', ap.access_via,
          'provider_slots', coalesce(ps.slots, '[]'::jsonb)
        )
        ORDER BY ap.created_at DESC, ap.id
      )
      FROM accessible_projects ap
      LEFT JOIN provider_slots ps
        ON ps.project_id = ap.id
    ), '[]'::jsonb),
    'access_overview', (SELECT payload FROM access_overview)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.enterprise_projects_bootstrap(uuid, uuid, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enterprise_projects_bootstrap(uuid, uuid, timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enterprise_projects_bootstrap(uuid, uuid, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_projects_bootstrap(uuid, uuid, timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
