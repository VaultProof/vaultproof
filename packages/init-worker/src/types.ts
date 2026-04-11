export interface Env {
  ALLOWED_ORIGINS: string;
  VAULT_ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  created_at: string;
  revoked_at: string | null;
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
  share2_encrypted: string;
  created_at: string;
  revoked_at: string | null;
}
