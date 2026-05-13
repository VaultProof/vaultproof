# VaultProof Enterprise Security Audit And Safe Pentest - 2026-05-13

## Scope

Audited the live VaultProof Enterprise GCP demo system at `https://enterprise.vaultproof.dev` and the local source tree in `/Users/nelson/projects/zkvault`.

This was a non-destructive audit and safe pentest. I did not run brute force, credential stuffing, destructive payloads, high-volume rate-limit tests, data modification tests, or real upstream provider abuse. The live tests were limited to safe HTTP probes, auth-denial checks, Cloud Armor scanner probes, request-size validation, and read-only GCP posture inspection.

Live enterprise build under test:

- Enterprise URL: `https://enterprise.vaultproof.dev`
- GCP image tag: `pilot-success-20260513`
- Runtime readiness: `production_ready: true`
- Security profile: `google-confidential-production`
- Audit timestamp: `2026-05-13T09:00:41Z`

## Commands And Checks Run

Local checks:

- `npm run test:enterprise-control-plane-smoke`
- `npm run test:enterprise-smoke`
- `npm run test:enterprise-apim-policies`
- `npm audit --omit=dev --workspace @vaultproof/enterprise-control-plane --audit-level=moderate`
- `npm audit --omit=dev --workspace @vaultproof/enterprise-secure-executor --audit-level=moderate`
- `npm audit --omit=dev --audit-level=moderate`
- `npm audit --audit-level=moderate`
- Secret-pattern scan for private key markers, JWT-like values, OAuth-secret-like values, and `sk-...` API-key-like values. The scan listed file paths only and did not print candidate secrets.

Live checks:

- `npm run verify:gcp-enterprise-edge`
- `npm run verify:gcp-enterprise-cloud-armor`
- `npm run qa:enterprise-live-app`
- `npm run qa:enterprise-login`
- `RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch`
- Safe live HTTP probes for security headers, readiness redaction, unauthenticated API denial, internal-admin route isolation, Cloud Armor scanner blocking, hostile CORS, and oversized request rejection.
- Public TCP reachability check to the VM external IP on ports `22`, `80`, `443`, `3001`, and `3002`.
- Read-only GCP inspection of firewall rules, VM Shielded/Confidential settings, KMS IAM, Secret Manager IAM, backend service posture, and Cloud Armor rules.

## Passing Results

- Enterprise control-plane smoke passed.
- Enterprise secure-executor smoke passed.
- Gateway/APIM policy smoke passed.
- Enterprise control-plane workspace production audit reported `0 vulnerabilities`.
- Enterprise secure-executor workspace production audit reported `0 vulnerabilities`.
- Live GCP edge is healthy; DNS points at the GCP edge IP; managed TLS is active.
- Live `/readiness` reports `production_ready: true` and `security_profile: google-confidential-production`.
- Live `/readiness` did not expose accepted signing key IDs, service-role material, origin-lock secret values, executor signing secrets, or provider API-key patterns.
- Security headers are present on app/API responses: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy, and permissions policy.
- HTML CSP uses nonces and `frame-ancestors 'none'`.
- Unauthenticated `/api/v1/enterprise/orgs` and `/api/v1/enterprise/projects/bootstrap` returned `401`.
- Internal-admin API routes returned `404` on `enterprise.vaultproof.dev`, including with a spoofed `x-forwarded-host: admin.vaultproof.dev` header.
- Hostile CORS preflight did not receive an `access-control-allow-origin` response.
- Cloud Armor is attached to the enterprise backend and blocks `/.env` with `403`.
- The live request body cap returned `413` for an oversized unauthenticated request.
- Public TCP probes to the VM external IP timed out on `22`, `80`, `443`, `3001`, and `3002`.
- GCP firewall rules expose only:
  - TCP `22` from IAP range `35.235.240.0/20`.
  - TCP `3001` from Google load-balancer ranges `130.211.0.0/22` and `35.191.0.0/16`.
  - No public firewall exposure for executor port `3002`.
- The runtime VM is a GCP Confidential VM with Secure Boot, vTPM, and integrity monitoring enabled.
- KMS decrypt for `vaultproof-unwrap` is scoped to `vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com`.
- Cloud Armor rules are active, not preview-only, for scanner blocking and coarse throttles.
- The enterprise control plane and executor Dockerfiles run as non-root `node`.

## Findings

### P1 - Rotate Setup-Shared Secrets Before Paid Customer Use

Several sensitive credentials have been handled during setup/demo work outside the ideal final production path, including Supabase service-role material, OAuth client secret material, live provider key material, origin-lock/runtime signing material, or related operational secrets. Do not assume any setup-shared secret is safe for paid customer onboarding.

Status:

- No raw secret values were printed into this report.
- Live customer packets continue to exclude provider keys, encrypted shares, service-role keys, OAuth client secrets, origin-lock values, executor signing secrets, runtime-token secrets, and unwrap roots.

Required action:

- Rotate the Supabase service-role key before paid customer onboarding.
- Rotate the Google OAuth client secret if it was ever shared outside the provider console.
- Rotate the MiniMax/provider pilot key before paid customer traffic.
- Rotate origin-lock, executor signing, and runtime-token secrets after final demo wiring stabilizes.
- Republish GCP Secret Manager env versions, reset the VM, and rerun the strict launch gate.

### P1 - Strict Login/OAuth QA Is Not Fully Proven In This Shell

`npm run qa:enterprise-login` passed public login page and public Supabase config checks, but strict session generation was skipped because no Supabase service-role key was loaded in this shell. The live customer launch gate also skipped login QA for the same reason.

Impact:

- The app login page and public Supabase anon config are healthy.
- The final proof that Supabase redirect allowlists, generated browser sessions, and authenticated org/bootstrap APIs work end-to-end still needs the service-role-backed QA run.

Required action:

- Run `RUN_LOGIN_QA=true LOGIN_QA_REQUIRE_SESSION=true npm run gate:gcp-customer-launch` with the rotated Supabase service-role key loaded.
- Run `LOGIN_QA_OAUTH_PROVIDER=google npm run qa:enterprise-login` after confirming the external OAuth provider app.
- Complete one human browser login test at `https://enterprise.vaultproof.dev/app/login`.

### P2 - Monorepo Next.js Dependency Is Vulnerable Outside The Enterprise Runtime

The enterprise control-plane and executor workspace audits reported `0 vulnerabilities`. The monorepo-wide production audit still reports a high-severity Next.js advisory chain plus a PostCSS advisory through `apps/dashboard`:

- `next@16.2.1` in `apps/dashboard`.
- `postcss` via Next.js.

The GCP enterprise runtime image is a Node control-plane/executor runtime, not the Next.js dashboard app. `npm ls next --omit=dev --workspace @vaultproof/enterprise-control-plane` and the executor equivalent returned empty.

Required action:

- Upgrade `apps/dashboard` Next.js to the fixed range before that dashboard is deployed or exposed.
- Keep enterprise runtime audits scoped to the enterprise workspaces in the release gate.

### P2 - VM Still Has An External NAT IP

The direct TCP probes to the VM external IP timed out and firewall posture is restrictive, so no direct service exposure was found. Still, the VM has an external NAT IP.

Impact:

- Current firewall posture blocks direct public access.
- For paid production, a private-only runtime is cleaner and reduces accidental exposure risk.

Recommended action:

- Move toward a no-external-IP VM with private artifact access, Cloud NAT if required, IAP/Bastion access for operations, and load-balancer-only ingress.

### P2 - Single Runtime Service Account Can Read Multiple Runtime Secret Bundles

Secret Manager IAM shows:

- `enterprise-secure-executor-env` is readable by `vaultproof-executor`.
- `enterprise-control-plane-env` is readable by both `vaultproof-control-plane` and `vaultproof-executor`.

That works for the single-VM demo startup model, but a host/container compromise could reach both env bundles.

Recommended action:

- Split control-plane and executor runtime identities before dedicated production.
- Prefer separate workload boundaries or separate VMs/services when moving from shared demo to production customer isolation.

### P2 - Origin-Lock Header Is A Routing Guard, Not A Deep Secret

The backend service has one custom request header, `x-vaultproof-origin-lock`, with the value masked in this audit. This protects origin access when combined with firewall restrictions, but anyone with sufficient Compute backend-service read access can inspect configured custom headers.

Recommended action:

- Keep treating origin-lock as a rotateable routing guard.
- Rotate it after operator access changes or broad audit exposure.
- For paid production, add stronger private-origin controls such as no external VM IP, mTLS/private service connectivity, and tightly scoped operator IAM.

### P2 - Replay And Rate-Limit State Is In-Memory

Source review confirms runtime-token context cache, rate-limit buckets, and executor replay protections are process-local/in-memory. This is acceptable for the current single shared demo VM, but restarts clear state and multi-VM scaling would not share counters/nonces.

Recommended action:

- Move replay nonces and rate-limit counters to durable/shared storage before high-volume or multi-runtime enterprise launch.

### P3 - Enterprise CSP Still Allows Legacy/B2C Connect Origins

The live app did not load old B2C APIs in page content checks, but `security-headers.ts` still allows these connect origins in CSP:

- `https://api.vaultproof.dev`
- `https://staging-api.vaultproof.dev`
- `https://init.vaultproof.dev`
- `https://vaultproof-init-staging.vaultproof.workers.dev`

Impact:

- This does not create an exploit by itself.
- If an XSS bug were introduced later, the broader `connect-src` list gives injected code more allowed destinations than the enterprise app needs.

Recommended action:

- Tighten enterprise `connect-src` to Supabase, Mixpanel only when enabled, and same-origin enterprise APIs.
- Keep any legacy/B2C origins out of the enterprise CSP unless a specific enterprise feature needs them.

### P3 - Secret-Pattern Scan Has Candidate Examples/Public Tokens To Review

The safe secret-pattern scan found no private key markers and no Google OAuth-secret-like strings. It did find:

- API-key-like `sk-...` strings in docs, tests, and helper scripts.
- JWT-like public anon-token patterns in static site/debug files.

Most appear to be examples, tests, generated public anon config, or demo helper material. Because the repo may be pushed or shared, keep treating this as hygiene debt.

Recommended action:

- Replace realistic `sk-...` examples with obviously fake non-token strings.
- Keep public Supabase anon keys only where needed for browser login.
- Avoid committing debug scripts that contain real project anon tokens unless the repo is private and the token is intentionally public.

### P3 - Public `/readiness` Still Fingerprints The Stack

`/readiness` is customer-useful and redacted, but it still tells unauthenticated users that the stack uses GCP, Supabase, origin-lock, and GCP Cloud KMS.

Recommended action:

- Keep public readiness for the demo and sales proof path.
- Revisit an operator-token or customer-authenticated readiness endpoint before broader paid production.

## Safe Pentest Summary

No unauthenticated enterprise data exposure, internal-admin exposure, permissive hostile CORS, direct VM port exposure, missing app security headers, or readiness secret leakage was found in this pass.

The system is credible for a controlled demo, provided the remaining gaps are clearly held as launch blockers before paid customer traffic:

1. Rotate setup-shared secrets.
2. Run strict Supabase login/OAuth QA.
3. Patch or isolate the non-enterprise Next.js dashboard dependency.
4. Tighten enterprise CSP connect destinations.
5. Plan private runtime networking and split workload identities for production.

## Suggested Next Fix Order

1. Run the strict login/OAuth QA with rotated Supabase service-role credentials.
2. Rotate Supabase, OAuth, provider, origin-lock, executor signing, and runtime-token secrets.
3. Remove legacy/B2C connect origins from the enterprise CSP.
4. Upgrade `apps/dashboard` Next.js/PostCSS or keep it explicitly out of enterprise deployment.
5. Prepare the no-external-IP runtime migration plan.
6. Design durable replay/rate-limit storage before scaling beyond one VM.
