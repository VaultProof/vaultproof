-- VaultProof init: projects system
-- Separate namespace from developer_keys / key_slots so init-worker can evolve
-- independently and the old system can be deleted cleanly.

-- ── projects ────────────────────────────────────────────────────────────────
-- One row per `npx @vaultproof/init` run. Owns a vp-proj-xxx public identifier.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vp_proj_id text not null unique,
  name text,
  allowed_origins text,
  strict_origin boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists projects_vp_proj_id_idx on public.projects(vp_proj_id);

alter table public.projects enable row level security;

-- Users can see/manage their own projects via the dashboard (future use).
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
  for delete using (auth.uid() = user_id);

-- ── project_keys ────────────────────────────────────────────────────────────
-- Shamir-split secrets stored under a project. Share 1 is encrypted with the
-- worker's VAULT_ENCRYPTION_KEY; Share 2 is stored as-is (client-side split).
create table if not exists public.project_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,
  env_var text,
  share1_encrypted text not null,
  share2_encrypted text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (project_id, provider)
);

create index if not exists project_keys_project_id_idx on public.project_keys(project_id);

alter table public.project_keys enable row level security;

-- Service role writes; RLS SELECT allows project owner to list their keys via dashboard.
drop policy if exists project_keys_select_own on public.project_keys;
create policy project_keys_select_own on public.project_keys
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_keys.project_id and p.user_id = auth.uid()
    )
  );

-- Explicit grants for service_role (Supabase tables created via migrations
-- don't auto-GRANT — Nelson's feedback_supabase_grants memo).
grant select, insert, update, delete on public.projects to service_role;
grant select, insert, update, delete on public.project_keys to service_role;
