# VaultProof GCP Supabase Decision

Last updated: 2026-05-09

## Decision

VaultProof Enterprise will keep using managed Supabase for the GCP Goal 1 demo.

We are not moving the pilot database to Cloud SQL, AlloyDB, or self-hosted Supabase yet.

This is a demo-only launch path. We can start with a fresh database later when customer onboarding or compliance requirements make that worth doing.

## Why

Supabase is currently more than Postgres for VaultProof. The enterprise control plane and executor use:

- Supabase Auth for login, OAuth/session handling, and access-token validation.
- Supabase Admin Auth APIs for pilot account creation and member lookup.
- Supabase REST/service-role APIs for organizations, projects, provider slots, audit logs, alerts, and execution material.
- Supabase `auth.users` references in migrations and row-level policies.

Moving only Postgres to Cloud SQL would not preserve those auth/API surfaces. It would require either self-hosted Supabase or a rewrite of the auth/data access layer.

## Goal 1 Scope

For Goal 1 demo, use managed Supabase and configure the GCP runtime with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` for browser login

The runtime Secret Manager bundles remain the source of truth for the control plane and executor.

The server-side demo gate can use the service role to prove the dry-run execute path, but browser OAuth/password testing still needs the valid public anon key from Supabase Project Settings > API. The previous hardcoded app key is malformed and should not be used for the live browser login path.

## Cost

This keeps the GCP fixed runtime estimate unchanged, except for the existing Supabase plan cost. There is no new Cloud SQL or AlloyDB cost in Goal 1.

## Later Migration

Revisit a fresh GCP database after the demo if one of these becomes true:

- data residency or compliance requires GCP-hosted auth/data,
- Supabase cost becomes material,
- we want to own the auth stack,
- or we need private-only database access inside the GCP VPC.

The likely later path is either a fresh managed Supabase project or self-hosted Supabase on GCP, not plain Cloud SQL alone, unless the app is rewritten away from Supabase Auth and REST APIs.
