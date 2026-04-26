import {
  compareAccessRoles,
  getEmailDomain,
  hasRequiredAccessRole,
  isValidDomain,
  normalizeDomain,
  type OrganizationRole,
  type ProjectRole,
} from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { getSupabase } from './supabase.js';

export interface EnterpriseUserAuth {
  userId: string;
  email: string;
}

export interface ResolveOrganizationSsoBody {
  company_domain?: string | null;
}

export interface OrganizationMembershipContext {
  organization_id: string;
  organization_name: string;
  organization_kind: 'personal' | 'team';
  organization_owner_user_id: string;
  organization_role: OrganizationRole;
  membership_created_at: string;
}

export interface AccessibleProjectSummary {
  id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  caller_lock_policy: Record<string, unknown> | null;
  created_at: string;
  revoked_at: string | null;
  project_role: ProjectRole;
  access_via: 'project' | 'organization';
}

export function hasRequiredProjectRole(
  role: ProjectRole,
  minimum: ProjectRole,
): boolean {
  return hasRequiredAccessRole(role, minimum);
}

export async function authenticateUser(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Promise<EnterpriseUserAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token || token.startsWith('vp_') || token.startsWith('vp-proj-')) return null;

  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const userId = data.user.id;
  const email = data.user.email;
  if (!userId || !email) return null;

  return { userId, email };
}

export function resolveRequestedSsoDomain(
  email: string,
  body: ResolveOrganizationSsoBody,
): { companyDomain: string | null } {
  const emailDomain = getEmailDomain(email);
  const requestedDomain = normalizeDomain(body.company_domain || '');
  const companyDomain = requestedDomain && requestedDomain === emailDomain ? requestedDomain : emailDomain;

  if (!companyDomain || !isValidDomain(companyDomain)) {
    return { companyDomain: null };
  }

  return { companyDomain };
}

export async function listOrganizationMemberships(
  env: EnterpriseControlPlaneEnv,
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

  rows.sort((a, b) => {
    const aPersonal = a.organization_kind === 'personal' && a.organization_owner_user_id === userId ? 1 : 0;
    const bPersonal = b.organization_kind === 'personal' && b.organization_owner_user_id === userId ? 1 : 0;
    if (aPersonal !== bPersonal) return bPersonal - aPersonal;

    const roleDelta = compareAccessRoles(b.organization_role, a.organization_role);
    if (roleDelta !== 0) return roleDelta;

    return new Date(a.membership_created_at).getTime() - new Date(b.membership_created_at).getTime();
  });

  return rows;
}

export async function resolveOrganizationMembership(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  userId: string,
): Promise<OrganizationMembershipContext | null> {
  const memberships = await listOrganizationMemberships(env, userId);
  if (!memberships.length) return null;

  const requestedId = request.headers.get('x-vaultproof-organization')?.trim();
  if (!requestedId) return memberships[0] || null;

  return memberships.find((membership) => membership.organization_id === requestedId) || null;
}

export function hasRequiredOrganizationRole(
  role: OrganizationRole,
  minimum: OrganizationRole,
): boolean {
  return hasRequiredAccessRole(role, minimum);
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

  const rankDelta = compareAccessRoles(incoming.project_role, existing.project_role);
  if (rankDelta > 0) {
    target.set(incoming.id, incoming);
    return;
  }

  if (rankDelta === 0 && existing.access_via !== 'project' && incoming.access_via === 'project') {
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
    caller_lock_policy?: Record<string, unknown> | null;
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
    caller_lock_policy: project.caller_lock_policy || null,
    created_at: project.created_at,
    revoked_at: project.revoked_at,
    project_role: projectRole,
    access_via: accessVia,
  };
}

export async function listAccessibleProjects(
  env: EnterpriseControlPlaneEnv,
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
    caller_lock_policy: Record<string, unknown> | null;
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
          caller_lock_policy,
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
            caller_lock_policy,
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

  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((project) => !organizationId || project.organization_id === organizationId);
}

export async function getAccessibleProject(
  env: EnterpriseControlPlaneEnv,
  userId: string,
  projectId: string,
): Promise<AccessibleProjectSummary | null> {
  const projects = await listAccessibleProjects(env, userId);
  return projects.find((project) => project.id === projectId) || null;
}
