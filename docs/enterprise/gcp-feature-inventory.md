# VaultProof GCP Feature Inventory

Last updated: 2026-05-12

This file tracks what VaultProof features exist, which ones have been adapted for Google Cloud, and what still blocks production cutover. Update it every time a build changes product behavior, runtime behavior, infrastructure behavior, or customer-facing claims.

<!-- gcp-build-marker:start -->
Last validated GCP image build: `f41cf47`

- Control plane digest: `sha256:7a8b5c158f02ebf2ad1443db1968acf3bb1b35fbd6116ce1be487bf620475041`
- Executor digest: `sha256:b00cfabbea1801ae42caec16685845ad4eba10458968495697e16d6dbcc802c9`
- Updated: 2026-05-12T08:28:56.512Z
<!-- gcp-build-marker:end -->

## Runtime Features

| Feature | Status | Notes |
| --- | --- | --- |
| Enterprise control plane | Built on GCP image | Container image is pushed and running on the bootstrap VM. |
| Secure executor | Built on GCP image | Container image is pushed and running on the bootstrap VM. |
| Managed Supabase auth/database | Chosen for Goal 1 demo | Goal 1 keeps managed Supabase for Auth/OAuth/session handling, Admin Auth APIs, REST/service-role APIs, and Postgres; no Cloud SQL/self-hosted move in the demo scope. Fresh database can come later. |
| Signed execution envelope verification | Implemented | Executor accepts configured signing key IDs and rejects unknown/invalid signatures. |
| Runtime-token execute fast path | Built and deployed | Deployed in `runtime-fastpath-20260510`. Product proxy calls can use short-lived HMAC tokens scoped to one project plus optional provider, slug, method, upstream path prefix, and customer gateway constraints. Runtime-token calls bypass browser Supabase Auth but still enforce origin lock, caller-lock policy, execution policy, rate limits, signed envelopes, and governance audit. |
| Non-secret execute context cache | Built and deployed | Deployed in `runtime-fastpath-20260510`. The control plane caches only project/provider policy and routing metadata for a short TTL; encrypted provider shares and raw keys remain outside the cache and are still resolved/decrypted by the secure executor. |
| Replay protection | Implemented | In-memory replay guard is active for the current executor process. |
| Supabase material resolver | Implemented and configured on GCP | Live readiness reports the executor material resolver ready with managed Supabase credentials. |
| Execution result recorder | Implemented and configured on GCP | Dry-run execute passed through the live gate and records through the Supabase-backed path. |
| Project access-log rollups | Built and deployed | Deployed in `rollup-stats-20260509`. Supabase now has daily per-project/provider/status rollups, an insert trigger, backfill, and service-role-only `enterprise_project_access_overview(...)`; live authenticated Projects APIs report `statsSource: rollup_rpc`. |
| Provider request forwarding | Implemented | Existing executor path forwards to upstream provider with sanitized response headers. |
| Attestation evidence on execution result | Implemented | Supports Azure and GCP evidence types in the shared core type. |

## GCP Security Features

| Feature | Status | Notes |
| --- | --- | --- |
| Standard Cloud KMS unwrap key | Built | `vaultproof-unwrap`, protection level `SOFTWARE`, version `1`. No HSM. |
| Executor KMS decrypt IAM | Built | `vaultproof-executor` has `roles/cloudkms.cryptoKeyDecrypter` on the key. |
| GCP KMS executor provider | Implemented | `GcpKmsVaultUnwrapKeyProvider` decrypts encrypted unwrap root ciphertext through Cloud KMS. |
| In-process unwrap key cache | Implemented | GCP provider uses the same short TTL clamp as Azure release material. |
| GCP attestation evidence shape | Implemented | Evidence includes provider, project/location, token hash, key/version, protection level, VM resource, image digest, service account, and measurement summary. |
| GCP production readiness profile | Implemented | Executor reports `google-confidential-production` when required GCP config/evidence is present. |
| HSM avoidance | Implemented as policy | Shared pilot uses standard Cloud KMS. Cloud HSM is documented only as a later explicit upgrade. |

## Compute And Network Features

| Feature | Status | Notes |
| --- | --- | --- |
| Dedicated GCP VPC | Built | `vaultproof-enterprise`, custom subnet mode. |
| Runtime subnet | Built | `vaultproof-enterprise-us-central1`, `10.60.0.0/24`. |
| IAP-only SSH ingress | Built | Firewall allows TCP 22 only from `35.235.240.0/20` to tagged runtime VM. |
| Public HTTPS ingress | Built | GCP edge is live at `34.102.179.105`; Cloudflare DNS points `enterprise.vaultproof.dev` at the edge, Google-managed TLS is active, and backend health is healthy. |
| Load-balancer origin lock header | Built and enforced | `enterprise-origin-lock-secret` exists in Secret Manager, the GCP backend service injects `x-vaultproof-origin-lock`, and the control plane requires the matching value. |
| Cloud Armor edge guardrail | Built | `npm run configure:gcp-enterprise-cloud-armor` creates `vaultproof-enterprise-armor`, attaches it to the enterprise backend, blocks common secret/config/admin scanner paths, and applies per-IP throttles to secure execute, enterprise API, and public edge routes. |
| Public readiness summary | Built | `/readiness` now returns a summary view for public checks and hides raw executor internals such as accepted signing key IDs and hardware-bound key flags. |
| Bootstrap Confidential VM | Built | `vaultproof-enterprise-runtime-1`, `n2d-standard-2`, AMD SEV, Secure Boot, vTPM, integrity monitoring. |
| Container runtime on VM | Built | Startup script installs Docker, pulls Artifact Registry images, and runs both containers on host network. |
| Secret Manager env loading | Built and live | Startup script loaded real version `1` env bundles for the control plane and executor after the VM reset. |

## Build And Release Features

| Feature | Status | Notes |
| --- | --- | --- |
| Cloud Build image pipeline | Built | `cloudbuild.enterprise.yaml` builds control-plane and executor images. |
| GCP image build helper | Built | `npm run build:gcp-enterprise-images`. |
| Build status doc refresh | Built | Successful image builds refresh `docs/enterprise/gcp-build-status.md` and this file's build marker. |
| GCP provision helper | Built | `npm run provision:gcp-enterprise-core`. |
| GCP VM deploy helper | Built | `npm run deploy:gcp-enterprise-vm`. |
| Env render helpers | Built | Render control-plane and executor env files from local environment variables. |
| Secret Manager publish helper | Built | Validates rendered env files, rejects bootstrap placeholders, and publishes new Secret Manager versions. |
| GCP runtime evidence collector | Built | `npm run collect:gcp-runtime-evidence` queries the runtime VM and KMS key, rejects non-Confidential/non-SOFTWARE-KMS posture for the shared pilot, and emits the env exports needed by executor readiness. |
| Goal 1 runtime-secret preparer | Built | `npm run prepare:gcp-first-goal-runtime` renders both env bundles, collects evidence when needed, encrypts or reuses the unwrap root through GCP KMS, loads the origin-lock secret, publishes Secret Manager versions when confirmed, optionally seeds pilot data, and can reset the VM. |
| KMS unwrap root encryption helper | Built | Encrypts new or supplied root material through Cloud KMS and prints ciphertext env value. |
| Pilot account seed helper | Built | `scripts/create-enterprise-demo-account.mjs` seeds org/project/member data, creates a demo placeholder provider slot by default, and can create a live OpenAI provider slot when supplied `DEMO_PROVIDER_API_KEY` plus the matching unwrap root. |
| Sealed provider slot ingest helper | Built | `npm run seal:enterprise-provider-slot` locally Shamir-splits and encrypts a provider key with the vault unwrap root, upserts `project_keys.share1_encrypted` and `project_keys.share2_encrypted`, and records a governance audit event without printing raw key material. See `docs/enterprise/provider-key-ingest.md`. |
| GCP public edge helper | Built | Creates global IP, SSL cert, backend service, health check, TLS policy, forwarding rule, and restricted LB firewall. |
| GCP origin-lock helper | Built | `npm run configure:gcp-enterprise-origin-lock` creates/reuses the Secret Manager value and applies it to the backend service without printing the secret. |
| GCP Cloud Armor helper | Built | `npm run configure:gcp-enterprise-cloud-armor` and `npm run verify:gcp-enterprise-cloud-armor` configure and verify the enterprise backend security policy, expected rule priorities, live `/health`, and blocked `/.env` scanner probes. |
| GCP public edge verifier | Built | Checks forwarding rule, managed cert, backend health, DNS, `/health`, and `/readiness`. |
| GCP customer launch gate | Built | Runs local build/smoke/script checks and can require live edge plus live app QA after DNS is ready. |
| GCP first-goal gate | Built | `npm run gate:gcp-first-goal` requires live readiness, pilot Supabase data, a usable provider slot, and a dry execute token before it reports done. Demo placeholders are accepted by default; set `GOAL1_DEMO_ONLY=false` to require live encrypted provider material. |
| Build-context secret exclusions | Built | `.dockerignore` and `.gcloudignore` now exclude PEM/key/env material before local Docker or Cloud Build uploads. |
| Non-root runtime containers | Built | Control-plane and executor Dockerfiles set `USER node`; deployed in GCP image tag `security-hardening-20260509`. |
| Request body size cap | Built | Control-plane and executor HTTP servers reject request bodies over 5 MiB with HTTP 413; deployed in GCP image tag `security-hardening-20260509`. |
| Security audit report | Built | Current audit is recorded in `docs/enterprise/security-audit-2026-05-09.md`. |

## Enterprise App Features

| Feature | Status | Notes |
| --- | --- | --- |
| Enterprise dashboard | Existing | Control-plane pages are present in the enterprise app image. |
| Customer launch checklist | Built | `/app/launch` is a customer-facing go-live board with live readiness summary, auto/manual launch tasks, browser-saved checklist progress, direct workflow links, and a copyable launch brief for customer testing. |
| Customer evidence packet | Built | `/app/evidence` assembles readiness, access-review, audit export links, provider posture, rollout workflow, and a copy/download JSON proof packet scoped to the selected organization without exposing secrets. |
| Buyer commercial package view | Built | `/app/plans` now explains the first paid-pilot package, included controls, contract-controlled capacity envelope, expansion path, guardrails, security boundaries, and links into evidence, launch, technical guide, and runbooks for customer review. |
| Email API key and secret protection demo | Built | `/app/keys` now has email-provider defaults for Resend, SendGrid, Mailgun, Postmark, and AWS SES, a customer-facing email API key demo panel, protected email dry-run actions, blocked-recipient policy testing, launch/evidence packet coverage, and audit metadata that classifies email-provider calls as `email_api_key` / `email_provider_send`. The execute route enforces email sender-domain, recipient-domain, recipient-address, and template-ID policy and records denial evidence from derived fields only. Raw provider keys still stay out of browser flows; live sandbox sends require sealed provider material through the local ingest helper. General secret slots remain use-only by default and must never be emailed or casually revealed. |
| Dashboard reference palette | Built | The live dashboard/app shell now uses the supplied mint, deep green, mustard gold, white card, and teal accent palette. Live HTML verification checks the deployed palette values on `https://enterprise.vaultproof.dev/app/dashboard`. |
| Enterprise homepage dashboard light theme | Built | The public enterprise homepage now uses the same light dashboard palette, white card surfaces, green/mustard accents, GCP demo copy, and headline `Active Key Protection for every API call.` Live HTML verification checks the deployed palette values on `https://enterprise.vaultproof.dev/` and rejects the old beige/brown tokens. |
| Provider slot add button | Built | `/app/keys` now has an admin-only add-slot flow backed by `POST /api/v1/enterprise/projects/:projectId/providers`. It creates demo/dry-run provider slots with placeholder material and rejects raw live provider keys; use the sealed local ingest helper for live upstream material. |
| Provider material status visibility | Built and deployed | Deployed in `provider-material-status-20260509`. Project and Provider Slots pages classify active slots as `live sealed`, `demo placeholder`, `mixed`, or `missing` without exposing encrypted share payloads; live API verification after the 2026-05-10 seal showed the pilot MiniMax slot is `sealed-live`, `material_ready: true`, and no share fields leak. The OpenAI slot is back to `demo-placeholder`. |
| Toolbar link button styling | Built | Rendered enterprise app pages now style toolbar anchors such as `open control`, `dashboard`, and CSV exports as full pill buttons instead of plain text links. |
| Sidebar provider-neutral label | Built | The universal enterprise sidebar now uses provider-neutral wording such as `confidential dashboard` instead of showing `GCP` in the brand subtitle. |
| Legacy dashboard theme removal | Built | Removed the old dark-theme toggle/storage path and old sidebar CSS from customer-facing enterprise app pages; live HTML checks show no old theme markers on `/`, `/app/dashboard`, Members, Audit, Alerts, Plans, Runbooks, or Logout. |
| Dark-mode code removal | Built | Deployed in `remove-darkmode-20260509`. The enterprise app shell no longer injects a theme boot script, writes a `data-enterprise-theme` attribute, stores a theme preference, or ships dark/light toggle labels; the dashboard palette is now the only app shell theme. |
| Universal enterprise app sidebar | Built | The enterprise dashboard, static control/org pages, and all planned app pages render the same VaultProof-themed sidebar with app links, CSV exports, Docs/Status/Support, and logout. Local smoke and live app QA cover the deployed pages and links. |
| Control/org sidebar parity | Built | `/app/control` and `/app/org` now use the same sidebar brand subtitle and the static app router swaps the universal sidebar when moving between shell pages. |
| Control/org canonical URL and typography | Built | Deployed in `sidebar-canonical-20260509`. The static Control and Org pages hide the legacy static topbar/page frame, force the universal sidebar typography to match the rest of the dashboard, and clean old `?org=<uuid>` URLs back to `/app/control` or `/app/org` while keeping the selected organization in local storage. Live HTML verification passed for both long-form URLs. |
| Projects page bootstrap load | Built | `/app/projects`, `/app/keys`, and `/app/activity` now load orgs, projects, provider slots, and overview stats from `GET /api/v1/enterprise/projects/bootstrap`. Deployed consolidated bootstrap RPC median is about 383 ms for authenticated bootstrap; direct stats overview remains about 474 ms median. |
| Consolidated Projects bootstrap RPC | Built and deployed | Deployed in `bootstrap-rpc-20260510`. `supabase/migrations/20260510010000_enterprise_projects_bootstrap_rpc.sql` adds service-role-only `enterprise_projects_bootstrap(...)`; the control plane uses it first and falls back to the older query chain only if the RPC is unavailable. This removes separate membership, direct project access, org-wide project access, provider slot, duplicate key-count, and rollup HTTP calls from bootstrap after auth. |
| Supabase OAuth login | Existing, needs final browser QA | Managed Supabase OAuth/Auth stays in the Goal 1 demo. The control-plane runtime env now includes `SUPABASE_ANON_KEY`; confirm callback/site URLs include `https://enterprise.vaultproof.dev/app/login` and run human browser QA. |
| Enterprise login readiness QA | Built | `npm run qa:enterprise-login` validates the live login page, public Supabase URL/anon key, redirect logic, and, with `LOGIN_QA_REQUIRE_SESSION=true` plus service-role env, generates a temporary magic-link session for `ken@vaultproof.dev` and calls authenticated org/bootstrap APIs. Optional `LOGIN_QA_OAUTH_PROVIDER=google` checks the public OAuth authorize redirect after the provider is configured. |
| Goal 1 gate test session | Built | `npm run gate:gcp-first-goal` can generate a temporary Supabase magic-link test session for the pilot user when service-role credentials are available and no access token is supplied. The live demo gate returned `status: done` on 2026-05-10 for `ken@vaultproof.dev` with demo placeholder provider material and dry execute. |
| Internal admin hostname support | Existing | `admin.vaultproof.dev` accepted by control plane config. |
| Internal admin preview routes | Existing | Controlled by environment flags. |
| Organization/project/member/audit/alert routes | Existing | Supabase credentials required for live data. |
| Verifier routes | Existing | Shared enterprise runtime attestation language is now customer-facing provider-neutral/GCP in the enterprise app templates; the shared core still keeps Azure evidence types for legacy provider compatibility. |
| Execute API | Built and deployed | Dispatches signed envelopes to executor; GCP readiness evidence is summarized in audit metadata. Live dashboard-session dry-run validation on `bootstrap-rpc-20260510` returned 12/12 `202` responses with 634 ms median and 752 ms p95. After `runtime-fastpath-20260510`, runtime-token dry run returned 6/6 `202` responses with 255 ms median and 320 ms p95, and runtime-token MiniMax upstream dispatch returned 3/3 `200` responses with 2,198 ms median. |

## Customer-Facing Security Claims

| Claim Area | Status | Notes |
| --- | --- | --- |
| Azure-specific app copy | Built | Customer-facing enterprise app templates and homepage copy were cleaned to GCP/Cloud KMS/provider-neutral language for the deployed demo. Older Azure docs and legacy provider code remain in the repo for migration history and compatibility. |
| GCP runtime claims | Partially built | Live app copy now matches the GCP demo runtime, but docs still need broader migration-history cleanup before paid production handoff. |
| No HSM claim | Built | The GCP pilot is standard Cloud KMS, not Cloud HSM. |
| Trusted source IP allowlists | Built | Project `allowed_ip_cidrs` no longer trusts raw `X-Forwarded-For`; it requires a trusted VaultProof source-IP header plus `ENTERPRISE_TRUSTED_SOURCE_IP_HEADER_SECRET`, so spoofed client headers fail closed. |
| Production-ready claim | Partially unblocked | The shared GCP demo runtime reports `production_ready: true`; do not make broad customer-production claims until browser OAuth, monitoring, and live provider dispatch are finished. |

## Current Production Blockers

- Run strict automated login readiness QA with `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login`.
- Run final human browser QA for `https://enterprise.vaultproof.dev/app/login`.
- Keep managed Supabase for the Goal 1 demo and confirm Supabase OAuth/Auth settings for `https://enterprise.vaultproof.dev/app/login`.
- Seal and test a live sandbox email-provider key only if the customer demo needs an actual email send; the browser demo flow supports protected dry-run without exposing raw keys.
- Run and keep `npm run verify:gcp-enterprise-cloud-armor` in the strict live launch gate.
- MiniMax live encrypted provider material is sealed for the pilot; add a separate OpenAI slot only if the demo specifically needs OpenAI.
- Rotate the Supabase service-role key and origin-lock value before paid customer onboarding.
- Clean older Azure migration/history docs before paid-production handoff; customer-facing app UI is cleaned for the GCP demo.

## Update Rule

- Update this file on every product/runtime build that changes feature behavior.
- `npm run build:gcp-enterprise-images` automatically refreshes the build marker above.
- Keep status words plain: `Built`, `Implemented`, `Existing`, `Blocked`, `Needs cleanup`, or `Not built`.
