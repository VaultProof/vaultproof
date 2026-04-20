/**
 * Dashboard user authentication via Supabase JWT.
 * Used ONLY on `POST /api/v1/init/*` routes where the init-cli is creating
 * a project or uploading shares. Proxy routes use `project-auth.ts` instead.
 */
import type {
  AccessibleProjectSummary,
  Env,
  OrganizationMembershipContext,
  OrganizationRole,
  ProjectRole,
} from '../types.js';
import { getSupabase } from './supabase.js';

export interface UserAuth {
  userId: string;
  email: string;
}

const ACCESS_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export async function authenticateUser(
  request: Request,
  env: Env,
): Promise<UserAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  // Reject dev keys and project ids — this endpoint is JWT-only.
  if (!token || token.startsWith('vp_') || token.startsWith('vp-proj-')) return null;

  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const userId = data.user.id;
  const email = data.user.email;
  if (!userId || !email) return null;

  return { userId, email };
}

function mergeProjectAccess(
  target: Map<string, AccessibleProjectSummary>,
  incoming: AccessibleProjectSummary,
): void {
  const existing = target.get(incoming.id);
  if (!existing) {
    target.set(incoming.id, incoming);
    return;
  }

  const existingRank = ACCESS_ROLE_RANK[existing.project_role];
  const incomingRank = ACCESS_ROLE_RANK[incoming.project_role];

  if (incomingRank > existingRank) {
    target.set(incoming.id, incoming);
    return;
  }

  if (incomingRank === existingRank && existing.access_via !== 'project' && incoming.access_via === 'project') {
    target.set(incoming.id, incoming);
  }
}

function normalizeProjectRow(
  project: {
    id: string;
    organization_id: string | null;
    vp_proj_id: string;
    name: string | null;
    allowed_origins: string | null;
    strict_origin: boolean;
    created_at: string;
    revoked_at: string | null;
  },
  projectRole: ProjectRole,
  accessVia: 'project' | 'organization',
): AccessibleProjectSummary {
  return {
    id: project.id,
    organization_id: project.organization_id,
    vp_proj_id: project.vp_proj_id,
    name: project.name,
    allowed_origins: project.allowed_origins,
    strict_origin: project.strict_origin,
    created_at: project.created_at,
    revoked_at: project.revoked_at,
    project_role: projectRole,
    access_via: accessVia,
  };
}

export async function listAccessibleProjects(
  env: Env,
  userId: string,
  organizationId?: string | null,
): Promise<AccessibleProjectSummary[]> {
  const supabase = getSupabase(env);
  const activeMemberships = await listOrganizationMemberships(env, userId);
  const activeOrganizationIds = new Set(activeMemberships.map((membership) => membership.organization_id));
  const byId = new Map<string, AccessibleProjectSummary>();
  type ProjectRow = {
    id: string;
    organization_id: string | null;
    vp_proj_id: string;
    name: string | null;
    allowed_origins: string | null;
    strict_origin: boolean;
    created_at: string;
    revoked_at: string | null;
  };

  const [{ data: projectRows }, { data: orgRows }] = await Promise.all([
    supabase
      .from('project_members')
      .select(`
        role,
        projects!inner (
          id,
          organization_id,
          vp_proj_id,
          name,
          allowed_origins,
          strict_origin,
          created_at,
          revoked_at
        )
      `)
      .eq('user_id', userId)
      .is('projects.revoked_at', null),
    supabase
      .from('organization_members')
      .select(`
        role,
        organizations!inner (
          id,
          projects (
            id,
            organization_id,
            vp_proj_id,
            name,
            allowed_origins,
            strict_origin,
            created_at,
            revoked_at
          )
        )
      `)
      .eq('user_id', userId)
      .in('role', ['owner', 'admin']),
  ]);

  for (const row of (projectRows || []) as unknown as Array<{
    role: ProjectRole;
    projects: ProjectRow | ProjectRow[] | null;
  }>) {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (!project) continue;
    if (project.organization_id && !activeOrganizationIds.has(project.organization_id)) continue;
    mergeProjectAccess(byId, normalizeProjectRow(project, row.role, 'project'));
  }

  for (const row of (orgRows || []) as unknown as Array<{
    role: 'owner' | 'admin';
    organizations: {
      id: string;
      projects: ProjectRow[] | null;
    } | Array<{
      id: string;
      projects: ProjectRow[] | null;
    }> | null;
  }>) {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!organization) continue;
    for (const project of organization.projects || []) {
      if (project.revoked_at) continue;
      mergeProjectAccess(byId, normalizeProjectRow(project, row.role, 'organization'));
    }
  }

  return [...byId.values()].sort((a, b) => {
    const aTs = new Date(a.created_at).getTime();
    const bTs = new Date(b.created_at).getTime();
    return bTs - aTs;
  }).filter((project) => !organizationId || project.organization_id === organizationId);
}

export async function getAccessibleProject(
  env: Env,
  userId: string,
  projectId: string,
): Promise<AccessibleProjectSummary | null> {
  const projects = await listAccessibleProjects(env, userId);
  return projects.find((project) => project.id === projectId) || null;
}

export function hasRequiredProjectRole(
  role: ProjectRole,
  minimum: ProjectRole,
): boolean {
  return ACCESS_ROLE_RANK[role] >= ACCESS_ROLE_RANK[minimum];
}

export function hasRequiredOrganizationRole(
  role: OrganizationRole,
  minimum: OrganizationRole,
): boolean {
  return ACCESS_ROLE_RANK[role] >= ACCESS_ROLE_RANK[minimum];
}

export async function getPersonalOrganizationId(
  env: Env,
  userId: string,
): Promise<string | null> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('kind', 'personal')
    .is('archived_at', null)
    .maybeSingle();

  if (error || !data?.id) return null;
  return data.id as string;
}

export async function listOrganizationMemberships(
  env: Env,
  userId: string,
): Promise<OrganizationMembershipContext[]> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('organization_members')
    .select(`
      role,
      created_at,
      organizations!inner (
        id,
        name,
        kind,
        owner_user_id,
        created_at
      )
    `)
    .eq('user_id', userId)
    .is('organizations.archived_at', null);

  if (error || !data?.length) return [];

  const rows = (data as unknown as Array<{
    role: OrganizationRole;
    created_at: string;
    organizations: {
      id: string;
      name: string;
      kind: 'personal' | 'team';
      owner_user_id: string;
      created_at: string;
    } | Array<{
      id: string;
      name: string;
      kind: 'personal' | 'team';
      owner_user_id: string;
      created_at: string;
    }> | null;
  }>).map((row) => {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!organization) return null;
    return {
      organization_id: organization.id,
      organization_name: organization.name,
      organization_kind: organization.kind,
      organization_owner_user_id: organization.owner_user_id,
      organization_role: row.role,
      membership_created_at: row.created_at,
    } satisfies OrganizationMembershipContext;
  }).filter(Boolean) as OrganizationMembershipContext[];

  if (!rows.length) return [];

  rows.sort((a, b) => {
    const aPersonal = a.organization_kind === 'personal' && a.organization_owner_user_id === userId ? 1 : 0;
    const bPersonal = b.organization_kind === 'personal' && b.organization_owner_user_id === userId ? 1 : 0;
    if (aPersonal !== bPersonal) return bPersonal - aPersonal;

    const roleDelta = ACCESS_ROLE_RANK[b.organization_role] - ACCESS_ROLE_RANK[a.organization_role];
    if (roleDelta !== 0) return roleDelta;

    return new Date(a.membership_created_at).getTime() - new Date(b.membership_created_at).getTime();
  });

  return rows;
}

export async function getDefaultOrganizationMembership(
  env: Env,
  userId: string,
): Promise<OrganizationMembershipContext | null> {
  const rows = await listOrganizationMemberships(env, userId);
  return rows[0] || null;
}

export async function resolveOrganizationMembership(
  request: Request,
  env: Env,
  userId: string,
): Promise<OrganizationMembershipContext | null> {
  const memberships = await listOrganizationMemberships(env, userId);
  if (!memberships.length) return null;

  const requestedId = request.headers.get('x-vaultproof-organization')?.trim();
  if (!requestedId) {
    return memberships[0] || null;
  }

  return memberships.find((membership) => membership.organization_id === requestedId) || null;
}
