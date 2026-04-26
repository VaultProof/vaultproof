export type AccessRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ProjectRole = AccessRole;
export type OrganizationRole = AccessRole;

const ACCESS_ROLE_RANK: Record<AccessRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
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
