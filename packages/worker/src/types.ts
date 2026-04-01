export interface Env {
  BACKEND_URL: string;
  PROXY_SECRET: string;
  ALLOWED_ORIGINS: string;
  VAULT_ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CACHE: KVNamespace;
}

export interface DevKeyAuth {
  userId: string;
  keyId: string;
  rawKey: string;
  devKey: DevKeyRecord;
}

export interface DevKeyRecord {
  id: string;
  user_id: string;
  key: string;
  key_hash: string;
  label: string;
  mode: string;
  allowed_ips: string | null;
  allowed_providers: string | null;
  allowed_endpoints: string | null;
  allowed_key_slot_ids: string | null;
  alert_email: string | null;
  alert_threshold: number | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  last_used: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface KeySlotRecord {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  env_var: string | null;
  share1_encrypted: string;
  share2_encrypted: string | null;
  vault_commitment: string;
  auth_apps_root: string;
  status: string;
  daily_limit: number | null;
  monthly_limit: number | null;
  block_on_limit: boolean;
  created_at: string;
  rotated_at: string | null;
  expires_at: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  tier: string;
  kill_switch: boolean;
  global_daily_limit: number | null;
  global_monthly_limit: number | null;
}
