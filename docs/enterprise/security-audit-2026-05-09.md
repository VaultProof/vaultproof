# VaultProof Enterprise Security Audit - 2026-05-09

## Scope

Audited the VaultProof Enterprise GCP demo runtime and local source tree for `enterprise.vaultproof.dev`.

Checks performed:

- Static route and auth review for the enterprise control plane and secure executor.
- Redacted secret/config scan, excluding the frozen GCP runtime copy snapshots.
- Safe live probes against `https://enterprise.vaultproof.dev`.
- Read-only GCP inspection for firewall rules, VM posture, IAM bindings, Secret Manager IAM, KMS key IAM, and load-balancer backend config.
- Local enterprise smoke tests.

No destructive tests, brute force, credential stuffing, or real upstream provider calls were performed.

## Fixes Applied In Source

- Added a 5 MiB request body cap to the control plane and executor HTTP servers.
- Changed both runtime Docker images to run as the built-in non-root `node` user.
- Added PEM/key/env material exclusions to `.dockerignore` and `.gcloudignore`.
- Tightened the local permissions on `packages/extension copy.pem` from world-readable to owner-only.

These source fixes were deployed to GCP image tag `security-hardening-20260509` and the VM was reset onto that tag on 2026-05-09.

## Passing Checks

- `npm run test:enterprise-control-plane-smoke` passed.
- `npm run test:enterprise-smoke` passed.
- Live `/health` returned 200 with security headers.
- Live `/readiness` returned 200 and did not expose raw executor internals such as accepted signing key IDs.
- Unauthenticated `/api/v1/enterprise/orgs` returned 401.
- `/api/v1/internal-admin/session` on `enterprise.vaultproof.dev` returned 404.
- Spoofed `x-forwarded-host: admin.vaultproof.dev` still returned 404 on the enterprise host.
- Invalid JSON to `/execute` returned 400.
- Evil-origin CORS preflight did not receive an allow-origin header.
- GCP firewall exposes only IAP SSH and LB-to-control-plane traffic:
  - TCP 22 from `35.235.240.0/20`.
  - TCP 3001 from Google LB ranges `130.211.0.0/22` and `35.191.0.0/16`.
  - No firewall exposure for executor port 3002.
- Direct TCP reachability checks from outside the load balancer timed out for VM public IP ports 22, 80, 443, 3001, and 3002.
- VM is running as a GCP Confidential VM with Secure Boot, vTPM, and integrity monitoring enabled.
- KMS decrypt on `vaultproof-unwrap` is scoped to `vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com`.
- After hardening deployment, VM-side Docker inspect confirmed both live containers run image tag `security-hardening-20260509` with `user=node`.

## Findings

### P1 - Private Key File In The Local Workspace

`packages/extension copy.pem` exists locally. It is untracked by Git and `.gitignore` blocks PEM files, but before this audit it was world-readable and build upload ignore files did not block PEM files.

Status:

- Local file permissions were changed to owner-only.
- `.dockerignore` and `.gcloudignore` now exclude PEM/key/env files.

Remaining action:

- Confirm what the key was used for.
- Rotate/revoke it if it ever protected a real extension, certificate, service account, or signing workflow.
- Remove it from the workspace after rotation.

### P1 - Rotate Supabase Service Role Before Real Customers

The demo Supabase service-role credential has been handled during setup outside Secret Manager. Treat that key as setup-exposed before paid customer use.

Remaining action:

- Rotate the Supabase service-role key after the demo wiring is stable.
- Republish `enterprise-control-plane-env` and `enterprise-secure-executor-env`.
- Reset the VM and rerun the first-goal gate.

### P2 - Origin-Lock Header Is Visible In Compute Backend Config

The GCP load balancer injects the origin-lock header into backend requests. This works with the firewall restriction, but the configured header value is visible to principals/tools that can read Compute backend service configuration.

Current mitigations:

- Only Google LB source ranges can reach port 3001.
- The app requires the origin-lock value before app/API routes.

Remaining action:

- Treat the value as a rotateable routing guard, not as a deep secret.
- Rotate it after broad operator access or audit exposure.
- For paid production, consider mTLS/private service connectivity/Cloud Armor controls in addition to the header.

### P2 - Single Runtime Service Account Can Read Both Runtime Secret Bundles

The VM uses one runtime service account, and the VM startup script loads both control-plane and executor env secrets. That is acceptable for the demo VM, but it means a host/container compromise can reach both env bundles and the KMS decrypt path.

Remaining action:

- For customer-dedicated production, split duties with separate runtimes or a platform that supports per-workload identity boundaries.
- Keep the current IAM roles narrow; project-level roles are already limited to Artifact Registry read, logging, and monitoring.

### P2 - Replay And Rate Limit State Is In-Memory

Executor replay protection and control-plane rate-limit buckets are in memory. This is fine for a single demo VM, but restarts clear the state and multi-VM scaling would not share it.

Remaining action:

- Move replay nonces and rate-limit counters to durable/shared storage before multi-tenant or high-volume customer launch.

### P2 - Request Body Limit Was Missing

Both Node servers previously read non-GET bodies without a size cap, which could cause avoidable memory pressure.

Status:

- Fixed with a 5 MiB cap and 413 response.
- Deployed to the live GCP runtime in image tag `security-hardening-20260509`.

### P2 - Containers Ran As Root

The runtime Dockerfiles did not set a non-root user.

Status:

- Fixed with `USER node`.
- Deployed to the live GCP runtime in image tag `security-hardening-20260509`.

### P3 - Public Health/Readiness Metadata

`/health` and `/readiness` intentionally expose high-level runtime readiness and configuration booleans. The live readiness endpoint hides raw executor internals, which is good, but the public metadata still helps fingerprint the stack.

Remaining action:

- Keep public readiness for demo evidence.
- Revisit whether `/readiness` should require an operator token before paid production.

### P3 - Public Supabase Anon Key Is Hardcoded In Static Helpers

The Supabase anon key is public by design, not a service-role secret. Still, hardcoding it in static helper files makes rotation/config drift easier.

Remaining action:

- Move debug helpers to environment-only config.
- Keep enterprise login using runtime injection from control-plane env.

## Recommended Next Steps

1. Rotate the origin-lock value after deployment because it was inspected during the audit.
2. Rotate the Supabase service-role key before any real customer demo data or paid customer onboarding.
3. Remove or rotate `packages/extension copy.pem`.
4. Add a persistent replay/rate-limit backend before scaling beyond the single demo VM.
5. Run browser login QA for `https://enterprise.vaultproof.dev/app/login`.
