# VaultProof GCP Goal 1 Test Plan

Last updated: 2026-05-09

## Goal 1: Testable Paid Pilot

Goal 1 is the first milestone where Ken can demo and test VaultProof Enterprise on Google Cloud.

The goal is not full self-serve billing, multi-region scale, Cloud HSM, or a database migration. It is a narrow shared GCP demo runtime that can prove the customer-facing path before we create any fresh customer database later.

## Database And Auth Decision

Goal 1 keeps managed Supabase for the demo. Do not move the demo database to Cloud SQL, AlloyDB, or self-hosted Supabase yet.

Reason: the app depends on Supabase Auth/OAuth/session handling, Admin Auth APIs, REST/service-role APIs, `auth.users`, and existing Supabase migrations. Plain Cloud SQL would only replace Postgres and would not preserve the auth/API surface. We can start fresh later after the demo.

Decision record: `docs/enterprise/gcp-supabase-decision.md`.

## Definition Of Done

Goal 1 is done when all of these are true:

- `https://enterprise.vaultproof.dev/health` returns `ok`.
- `https://enterprise.vaultproof.dev/readiness` returns `production_ready: true`.
- Readiness reports `security_profile: google-confidential-production`.
- Cloudflare DNS points `enterprise.vaultproof.dev` at the GCP global HTTPS edge.
- Google-managed TLS certificate is active.
- GCP backend health is healthy.
- Control plane has Supabase service-role credentials loaded.
- Secure executor has Supabase material resolver ready.
- Secure executor uses standard Cloud KMS mode `gcp-cloud-kms`.
- Executor unwrap ciphertext is configured.
- GCP attestation hash and measurement summary are configured.
- Load balancer injects `x-vaultproof-origin-lock`.
- Control plane requires the same origin-lock secret.
- A first pilot organization, user/member, project, and provider slot exist.
- A dry-run execute test reaches control plane, executor, policy, and audit recording.

## Current Status

Status: `done for the demo dry-run goal`.

Already done:

- Public GCP HTTPS edge is live.
- DNS cutover for `enterprise.vaultproof.dev` is done.
- Google-managed TLS is active.
- Backend health is healthy.
- GCP origin-lock backend header is configured.
- Fresh control-plane and executor images are running on the VM.
- Standard Cloud KMS key exists. No HSM.
- Goal gate exists as `npm run gate:gcp-first-goal`.
- Demo account seeding can now create dashboard placeholder provider slots for the dry-run demo, or a live decryptable OpenAI provider slot when the provider key and unwrap root are supplied.
- Goal 1 runtime-secret preparation exists as `npm run prepare:gcp-first-goal-runtime`.
- GCP runtime evidence collection exists as `npm run collect:gcp-runtime-evidence`.
- Managed Supabase remains the pilot auth/database provider.

Remaining blockers:

- Run final human browser login QA for `https://enterprise.vaultproof.dev/app/login`.
- Confirm the managed Supabase project has the required OAuth providers/login settings for `https://enterprise.vaultproof.dev/app/login`.
- Seed live encrypted provider material later if real upstream provider dispatch is needed.

## Commands

Check the live goal state:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
ENTERPRISE_TEST_ACCESS_TOKEN='...' \
npm run gate:gcp-first-goal
```

Publish real runtime env secret versions after rendering `enterprise-control-plane.env` and `enterprise-secure-executor.env`:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
ALLOW_GENERATE_NEW_UNWRAP_ROOT=true \
CONFIRM_GCP_FIRST_GOAL_RUNTIME=publish \
SEED_PILOT=true \
npm run prepare:gcp-first-goal-runtime
```

The prep command collects `GCP_ATTESTATION_TOKEN_HASH` and `GCP_MEASUREMENT_SUMMARY` automatically from the current GCP VM/KMS posture when those values are not already set.

That command is the demo-only path. It starts with fresh pilot-only unwrap material, publishes the runtime env secret versions, and seeds dashboard/dry-run pilot data with placeholder provider shares.

If later testing live provider dispatch, use an existing unwrap root or save the fresh unwrap root securely, then add:

```bash
DEMO_PROVIDER_API_KEY='sk-...' \
VAULT_UNWRAP_KEY_BASE64='same raw unwrap root encrypted into GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64'
```

Do not generate a new unwrap root against existing encrypted production/customer provider slots.

Seed a first pilot test account after Supabase credentials are available:

```bash
DEMO_EMAIL='ken@vaultproof.dev' \
DEMO_ORG_NAME='VaultProof Pilot' \
DEMO_PROJECT_NAME='First Paid Pilot' \
node scripts/create-enterprise-demo-account.mjs
```

If `DEMO_PROVIDER_API_KEY` and `VAULT_UNWRAP_KEY_BASE64` are omitted, the script creates dashboard data with placeholder provider shares. The first-goal gate accepts that in demo mode. Set `GOAL1_DEMO_ONLY=false` later when we want the gate to require live encrypted provider material.

Run a dry execute test after signing in and piping a Supabase access token:

```bash
printf '%s' "$ACCESS_TOKEN" | EXECUTE_DRY_RUN=true node scripts/enterprise-live-execute-test.mjs
```

## Ken Test Start

Ken can start testing when `npm run gate:gcp-first-goal` returns:

```json
{
  "status": "done",
  "goal": "Goal 1: Testable Paid Pilot"
}
```

The live gate returned that result on 2026-05-09 for the demo dry-run path. The control-plane runtime env now includes `SUPABASE_ANON_KEY`, and the gate can generate a temporary Supabase magic-link test session when no `ENTERPRISE_TEST_ACCESS_TOKEN` is provided. Browser login still needs final human QA and Supabase Auth redirect/provider settings confirmation.
