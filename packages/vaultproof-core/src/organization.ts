export const ORGANIZATION_ROLES = [
  'owner',
  'admin',
  'iam_admin',
  'security_admin',
  'platform_admin',
  'developer',
  'auditor',
  'member',
  'viewer',
] as const;

export const PROJECT_ROLES = [
  'owner',
  'admin',
  'project_admin',
  'operator',
  'developer',
  'auditor',
  'member',
  'viewer',
] as const;

export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
export type ProjectRole = typeof PROJECT_ROLES[number];
export type AccessRole = OrganizationRole | ProjectRole;

export interface OrganizationRoleDefinition {
  value: OrganizationRole;
  label: string;
  summary: string;
  permissions: string[];
  legacy?: boolean;
  privileged?: boolean;
}

export interface ProjectRoleDefinition {
  value: ProjectRole;
  label: string;
  summary: string;
  permissions: string[];
  legacy?: boolean;
  privileged?: boolean;
}

export const ORGANIZATION_ROLE_DEFINITIONS: readonly OrganizationRoleDefinition[] = [
  {
    value: 'owner',
    label: 'Owner',
    summary: 'Full workspace control, ownership transfer, and final break-glass authority.',
    permissions: ['all organization controls', 'owner grants', 'archive/restore', 'access review export'],
    privileged: true,
  },
  {
    value: 'admin',
    label: 'Admin',
    summary: 'Legacy broad admin role. Use narrower admin roles for least privilege when possible.',
    permissions: ['members', 'projects', 'policy', 'security controls', 'evidence'],
    legacy: true,
    privileged: true,
  },
  {
    value: 'iam_admin',
    label: 'IAM Admin',
    summary: 'Manages who can access VaultProof and how enterprise sign-in is configured.',
    permissions: ['invite users', 'change roles', 'assign project access', 'SSO setup', 'access review export'],
    privileged: true,
  },
  {
    value: 'security_admin',
    label: 'Security Admin',
    summary: 'Owns security posture, protected key controls, alerts, and incident response.',
    permissions: ['security policy', 'provider slot revoke', 'alerts', 'evidence', 'all project security controls'],
    privileged: true,
  },
  {
    value: 'platform_admin',
    label: 'Platform Admin',
    summary: 'Operates gateway, runtime, DNS/edge, readiness, and production traffic controls.',
    permissions: ['runtime readiness', 'gateway setup', 'project policy', 'provider operations', 'runbooks'],
    privileged: true,
  },
  {
    value: 'developer',
    label: 'Developer',
    summary: 'Builds and tests integrations on projects they are assigned to.',
    permissions: ['assigned project read', 'dry-run/live execution when project role allows', 'activity view'],
  },
  {
    value: 'auditor',
    label: 'Auditor',
    summary: 'Read-only compliance reviewer for evidence, access review, and audit trails.',
    permissions: ['read dashboard', 'read audit', 'export evidence', 'no configuration writes'],
  },
  {
    value: 'member',
    label: 'Member',
    summary: 'Legacy contributor role for assigned project work.',
    permissions: ['assigned project read', 'assigned project execution'],
    legacy: true,
  },
  {
    value: 'viewer',
    label: 'Viewer',
    summary: 'Read-only business visibility with no configuration changes.',
    permissions: ['read dashboard', 'read assigned project summaries'],
  },
] as const;

export const PROJECT_ROLE_DEFINITIONS: readonly ProjectRoleDefinition[] = [
  {
    value: 'owner',
    label: 'Project Owner',
    summary: 'Full control for one project, including project policy and provider operations.',
    permissions: ['project policy', 'provider slots', 'execution', 'project evidence'],
    privileged: true,
  },
  {
    value: 'admin',
    label: 'Project Admin',
    summary: 'Legacy broad project admin role.',
    permissions: ['project policy', 'provider slots', 'execution', 'project evidence'],
    legacy: true,
    privileged: true,
  },
  {
    value: 'project_admin',
    label: 'Project Admin',
    summary: 'Configures policy and provider controls for one assigned project.',
    permissions: ['project policy', 'provider slots', 'execution', 'project evidence'],
    privileged: true,
  },
  {
    value: 'operator',
    label: 'Operator',
    summary: 'Runs approved production traffic and reviews operational results for one project.',
    permissions: ['execution', 'activity view', 'no provider slot changes'],
  },
  {
    value: 'developer',
    label: 'Developer',
    summary: 'Integrates and tests an assigned project without changing security policy.',
    permissions: ['execution', 'activity view', 'no policy changes'],
  },
  {
    value: 'auditor',
    label: 'Auditor',
    summary: 'Read-only reviewer for one project.',
    permissions: ['project evidence read', 'project activity read'],
  },
  {
    value: 'member',
    label: 'Member',
    summary: 'Legacy project contributor role.',
    permissions: ['execution', 'activity view'],
    legacy: true,
  },
  {
    value: 'viewer',
    label: 'Viewer',
    summary: 'Read-only project visibility.',
    permissions: ['project summary read'],
  },
] as const;

const ACCESS_ROLE_RANK: Record<AccessRole, number> = {
  viewer: 0,
  auditor: 0,
  member: 1,
  developer: 1,
  operator: 1,
  admin: 2,
  iam_admin: 2,
  security_admin: 2,
  platform_admin: 2,
  project_admin: 2,
  owner: 3,
};

export function compareAccessRoles(left: AccessRole, right: AccessRole): number {
  return ACCESS_ROLE_RANK[left] - ACCESS_ROLE_RANK[right];
}

export function hasRequiredAccessRole(
  current: AccessRole,
  minimum: AccessRole,
): boolean {
  return ACCESS_ROLE_RANK[current] >= ACCESS_ROLE_RANK[minimum];
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value);
}

export function canManageOrganizationIam(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'iam_admin';
}

export function canViewOrganizationEvidence(role: OrganizationRole): boolean {
  return role === 'owner'
    || role === 'admin'
    || role === 'iam_admin'
    || role === 'security_admin'
    || role === 'platform_admin'
    || role === 'auditor';
}

export function getOrganizationWideProjectRole(role: OrganizationRole): ProjectRole | null {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'security_admin' || role === 'platform_admin') return 'admin';
  if (role === 'auditor') return 'viewer';
  return null;
}

export function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export function isValidDomain(domain: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
}

export function getEmailDomain(email: string): string {
  return normalizeDomain(email.split('@').pop() || '');
}
