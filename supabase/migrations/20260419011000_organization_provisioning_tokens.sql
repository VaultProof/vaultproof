create table if not exists public.organization_provisioning_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  token_prefix text not null,
  token_hash text not null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null
);

create unique index if not exists organization_provisioning_tokens_hash_uidx
  on public.organization_provisioning_tokens (token_hash);

create index if not exists organization_provisioning_tokens_org_idx
  on public.organization_provisioning_tokens (organization_id, created_at desc);
