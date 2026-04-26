-- Enterprise caller lock policy.
-- Flexible JSONB lets us add device, fleet, gateway, firmware, IP/CIDR, and
-- certificate identity locks without one migration per policy dimension.

alter table public.projects
  add column if not exists caller_lock_policy jsonb not null default '{}'::jsonb;

grant select, insert, update, delete on public.projects to service_role;

notify pgrst, 'reload schema';
