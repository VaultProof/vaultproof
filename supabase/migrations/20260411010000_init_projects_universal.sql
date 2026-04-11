-- Universal proxy support: add upstream config to project_keys so any Tier 1
-- Bearer-token REST API can be proxied without hardcoding providers in the worker.

alter table public.project_keys
  add column if not exists slug text,
  add column if not exists upstream_base_url text,
  add column if not exists auth_header_name text,
  add column if not exists auth_header_template text,
  add column if not exists extra_headers jsonb;

-- Slug is used as the URL segment for /p/:slug/* routing.
-- Must be unique per project.
create unique index if not exists project_keys_slug_key
  on public.project_keys (project_id, slug)
  where slug is not null;

-- Backfill slug for any existing rows (fresh table, safe no-op).
update public.project_keys
  set slug = provider
  where slug is null;

grant select, insert, update, delete on public.project_keys to service_role;
