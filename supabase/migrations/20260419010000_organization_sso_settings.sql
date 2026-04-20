create table if not exists public.organization_sso_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  company_domain text not null,
  sso_provider text,
  admin_email text,
  login_mode text not null default 'sso-first',
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_sso_settings_status_check check (status in ('requested', 'configured')),
  constraint organization_sso_settings_login_mode_check check (login_mode in ('sso-first', 'assisted'))
);

create unique index if not exists organization_sso_settings_domain_lower_uidx
  on public.organization_sso_settings (lower(company_domain));

create index if not exists organization_sso_settings_status_idx
  on public.organization_sso_settings (status);
