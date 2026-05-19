export interface Env {
  ALLOWED_ORIGINS: string;
  VAULT_ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RATE_LIMITER: DurableObjectNamespace;
  RESEND_API_KEY?: string;
  ALERTS_FROM_EMAIL?: string;
  ALERTS_REPLY_TO_EMAIL?: string;
  DEEPL_API_KEY?: string;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  created_at: string;
  revoked_at: string | null;
}

export type AccessRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ProjectRole = AccessRole;
export type OrganizationRole = AccessRole;

export interface AccessibleProjectSummary {
  id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  created_at: string;
  revoked_at: string | null;
  project_role: ProjectRole;
  access_via: 'project' | 'organization';
}

export interface OrganizationMembershipContext {
  organization_id: string;
  organization_name: string;
  organization_kind: 'personal' | 'team';
  organization_owner_user_id: string;
  organization_role: OrganizationRole;
  membership_created_at: string;
}

export interface ProjectKeyRecord {
  id: string;
  project_id: string;
  provider: string;
  slug: string | null;
  env_var: string | null;
  upstream_base_url: string | null;
  auth_header_name: string | null;
  auth_header_template: string | null;
  extra_headers: Record<string, string> | null;
  share1_encrypted: string;
  share2_b64: string;
  created_at: string;
  revoked_at: string | null;
}
