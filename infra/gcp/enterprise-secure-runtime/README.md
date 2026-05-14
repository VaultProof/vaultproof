# VaultProof Enterprise Secure Runtime On Google Cloud

Last updated: 2026-05-06

This folder is the Google Cloud deployment starting point for the VaultProof Enterprise control plane and secure executor.

It intentionally does **not** replace the self-serve Cloudflare path.

## Current GCP Foundation

- Project: `vaultproof-prod`
- Region: `us-central1`
- Zone: `us-central1-a`
- Billing: linked to `019623-FDBB0F-3D4240`
- Budget: `VaultProof Production Monthly`, `$50/month` alerting budget
- Artifact Registry: `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof`
- KMS key ring: `projects/vaultproof-prod/locations/us-central1/keyRings/vaultproof-runtime`
- Runtime env secrets:
  - `enterprise-control-plane-env`
  - `enterprise-secure-executor-env`
- Built images:
  - `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof/enterprise-control-plane:2cc6f4d`
  - `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof/enterprise-secure-executor:2cc6f4d`
- Image digests:
  - control plane: `sha256:6456f35890c0063dbae0a08ac41a6b4af030e16e4c19d8b59209dd43b36464d4`
  - executor: `sha256:c5976e25789d24b4b28fde8de1584172441dc7998e112bb88069ff45d51d2678`
- Bootstrap VM:
  - `vaultproof-enterprise-runtime-1`
  - zone: `us-central1-a`
  - machine type: `n2d-standard-2`
  - Confidential Compute: `SEV`
  - network: `vaultproof-enterprise`
  - subnet: `vaultproof-enterprise-us-central1`
  - internal IP: `10.60.0.2`
  - external IP: `34.9.204.178`
  - ingress: SSH only through IAP source range `35.235.240.0/20`
- Service accounts:
  - `vaultproof-control-plane@vaultproof-prod.iam.gserviceaccount.com`
  - `vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com`
  - `vaultproof-deploy@vaultproof-prod.iam.gserviceaccount.com`

## Target Runtime Shape

The first GCP lift uses:

1. Standard Cloud KMS for the vault unwrap root.
2. Compute Engine Confidential VM for the executor and control plane.
3. Secret Manager for runtime env bundles.
4. Artifact Registry for immutable container images.
5. Cloud Logging and Cloud Monitoring for evidence and operational telemetry.

The later high-trust path can move the executor to Confidential Space and optionally use Cloud HSM if a customer requires HSM-backed key custody. Do not enable HSM for the shared pilot runtime unless the cost/security tradeoff is explicitly approved.

## Build Images

From the repo root:

```bash
bash infra/gcp/enterprise-secure-runtime/build-images.sh
```

This builds and pushes:

- `enterprise-control-plane`
- `enterprise-secure-executor`

## Provision Core Runtime Resources

The first project foundation is already created, but this script is idempotent for the reusable pieces:

```bash
bash infra/gcp/enterprise-secure-runtime/provision-core.sh
```

It enables required APIs, ensures service accounts, creates the Artifact Registry repo, creates the KMS key ring, creates the standard Cloud KMS `vaultproof-unwrap` key, and grants the executor decrypt access on that key.

## Deploy The Bootstrap Confidential VM

The first VM uses a dedicated `vaultproof-enterprise` VPC, allows SSH only through IAP, and runs the control plane and executor containers on localhost. It intentionally reports not-ready until real env secret versions exist.

```bash
bash infra/gcp/enterprise-secure-runtime/deploy-confidential-vm.sh
```

Inspect boot logs:

```bash
gcloud compute instances get-serial-port-output vaultproof-enterprise-runtime-1 \
  --zone=us-central1-a \
  --project=vaultproof-prod \
  --port=1
```

Check local runtime status over IAP:

```bash
gcloud compute ssh vaultproof-enterprise-runtime-1 \
  --zone=us-central1-a \
  --project=vaultproof-prod \
  --tunnel-through-iap \
  --command='curl -sS http://127.0.0.1:3002/health; echo; curl -sS -H "Host: enterprise.vaultproof.dev" http://127.0.0.1:3001/readiness; echo'
```

Current expected blockers before real secret versions are added:

- `Supabase service role is not configured`
- `secure executor is not execution-ready`
- `secure executor material resolver is not ready`
- `GCP encrypted vault unwrap key is not configured`
- `attestation token hash is missing`

## Goal 1 Gate

Goal 1 is the first testable paid-pilot milestone. Ken can start testing the sellable GCP path when:

```bash
npm run gate:gcp-first-goal
```

returns `status: done`.

Until then, the command prints the exact blockers from the live edge and readiness response.

## Encrypt The Vault Unwrap Root

Do not put the raw unwrap key in an env file.

Before encrypting a new unwrap root, decide whether the GCP runtime should:

1. migrate the existing Azure/shared-demo encrypted shares to a new root, or
2. keep the existing root material by encrypting the same root with Cloud KMS, or
3. start with empty/new demo data only.

Do not deploy a production executor against existing Supabase encrypted shares with a different unwrap root; it will not be able to decrypt them.

If you are rotating to a new root:

```bash
bash infra/gcp/enterprise-secure-runtime/encrypt-vault-unwrap-key.sh
```

If you are migrating an existing root, pass it as base64:

```bash
VAULT_UNWRAP_KEY_BASE64='...' \
bash infra/gcp/enterprise-secure-runtime/encrypt-vault-unwrap-key.sh
```

The script prints `GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64=...`. Put that ciphertext in the executor env secret. The raw key stays local and is removed from the temporary file on exit.

Use the same raw unwrap root when seeding a live pilot provider slot:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
DEMO_EMAIL='ken@vaultproof.dev' \
DEMO_PROVIDER_API_KEY='sk-...' \
VAULT_UNWRAP_KEY_BASE64='same raw unwrap root encrypted above' \
node scripts/create-enterprise-demo-account.mjs
```

Without `DEMO_PROVIDER_API_KEY` and `VAULT_UNWRAP_KEY_BASE64`, the seed script creates dashboard placeholders only; that is useful for UI checks, but not enough for the first-goal execute gate.

## Render Runtime Env Files

For Goal 1, prefer the orchestrated helper. It renders both runtime env bundles into temporary files, encrypts the unwrap root through GCP KMS if needed, loads the origin-lock secret from Secret Manager, publishes new Secret Manager versions when confirmed, and can seed the first pilot account:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
VAULT_UNWRAP_KEY_BASE64='existing-or-new-32-byte-root-as-base64' \
CONFIRM_GCP_FIRST_GOAL_RUNTIME=publish \
SEED_PILOT=true \
DEMO_PROVIDER_API_KEY='sk-...' \
npm run prepare:gcp-first-goal-runtime
```

The helper automatically runs `npm run collect:gcp-runtime-evidence` when `GCP_ATTESTATION_TOKEN_HASH` or `GCP_MEASUREMENT_SUMMARY` is not already set. The collector validates the current VM/KMS posture and emits the static evidence env values used by the pilot readiness check.

Use `ALLOW_GENERATE_NEW_UNWRAP_ROOT=true` only for fresh pilot-only data. Do not generate a different unwrap root for existing encrypted provider slots.

The lower-level render commands remain available when each file needs to be prepared manually.

To inspect the evidence values without publishing secrets:

```bash
npm run collect:gcp-runtime-evidence
```

Executor:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS='enterprise-gcp-v1:...' \
GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64='...' \
GCP_KMS_KEY_VERSION='1' \
VAULTPROOF_EXECUTOR_BUILD_DIGEST='sha256:...' \
GCP_ATTESTATION_TOKEN_HASH='sha256-or-base64url-hash' \
GCP_CONFIDENTIAL_VM_RESOURCE_ID='projects/vaultproof-prod/zones/us-central1-a/instances/vaultproof-enterprise-runtime-1' \
GCP_MEASUREMENT_SUMMARY='approved-gcp-confidential-vm-measurement' \
bash infra/gcp/enterprise-secure-runtime/render-executor-env.sh > enterprise-secure-executor.env
```

Control plane:

```bash
SUPABASE_URL='https://...supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='...' \
ENTERPRISE_EXECUTOR_SIGNING_KEY_ID='enterprise-gcp-v1' \
ENTERPRISE_EXECUTOR_SIGNING_SECRET='...' \
bash infra/gcp/enterprise-secure-runtime/render-control-plane-env.sh > enterprise-control-plane.env
```

Review the files, then add them as Secret Manager versions:

```bash
CONFIRM_GCP_SECRET_PUBLISH=publish-gcp-runtime-secrets \
bash infra/gcp/enterprise-secure-runtime/publish-runtime-secrets.sh
```

To reset the VM after publishing so startup loads the latest secret versions:

```bash
CONFIRM_GCP_SECRET_PUBLISH=publish-gcp-runtime-secrets \
RESET_VM=true \
bash infra/gcp/enterprise-secure-runtime/publish-runtime-secrets.sh
```

## Readiness Expectations

The executor reports `security_profile: google-confidential-production` only when:

- `ENTERPRISE_CLOUD_PROVIDER=gcp`
- `VAULTPROOF_EXECUTOR_MODE=confidential`
- Cloud KMS key release mode is `gcp-cloud-kms`
- KMS protection level is present in evidence
- encrypted unwrap-key ciphertext is configured
- attestation hash, KMS key version, executor digest, VM resource ID, and measurement summary are present
- signing keys, Supabase material resolver, and replay protection are ready

## DNS Cutover

Keep `enterprise.vaultproof.dev` off Azure after shutdown. `enterprise.vaultproof.dev` is customer-facing only. Use `admin.vaultproof.dev` for the VaultProof employee admin console and keep `/api/v1/internal-admin/*` unavailable on the enterprise customer hostname.

## Configure The Public HTTPS Edge

`vaultproof.dev` DNS is currently hosted in Cloudflare. The GCP script can build the enterprise load balancer and reserve the IP. Point `enterprise.vaultproof.dev` at the runtime for customers, and point `admin.vaultproof.dev` at the same edge only after the admin certificate and employee allowlist are configured.

Before customer cutover, generate one origin-lock secret and put the same value in:

- the GCP backend service custom request header, through `ENTERPRISE_ORIGIN_LOCK_SECRET`
- the control-plane env secret, with `ENTERPRISE_REQUIRE_ORIGIN_LOCK=true`

Use the helper to create or reuse the Secret Manager value and apply it to the load balancer backend without printing the secret:

```bash
npm run configure:gcp-enterprise-origin-lock
```

## Configure Cloud Armor WAF And Rate Limits

Use Cloud Armor as the public edge guardrail before inviting customer traffic. The policy blocks common secret/config/admin scanner paths and applies per-IP throttles to the secure execute path, enterprise API routes, and the overall public edge.

```bash
npm run configure:gcp-enterprise-cloud-armor
npm run verify:gcp-enterprise-cloud-armor
```

Defaults:

- policy: `vaultproof-enterprise-armor`
- backend: `vaultproof-enterprise-backend`
- secret/config/admin scanner probes: HTTP 403
- secure execute route throttle: `240` requests/minute per IP
- enterprise API throttle: `900` requests/minute per IP
- public edge throttle: `2400` requests/minute per IP

Set `CLOUD_ARMOR_PREVIEW=true` only when you want to log rule matches without enforcing them.

Set `ROTATE_ORIGIN_LOCK_SECRET=true` to add a new secret version and update the backend header.

Build the edge:

```bash
ENTERPRISE_ORIGIN_LOCK_SECRET='...' \
bash infra/gcp/enterprise-secure-runtime/configure-public-edge.sh
```

This creates or updates:

- global static IP
- firewall rule allowing Google load-balancer/health-check ranges to TCP `3001`
- unmanaged instance group for the bootstrap VM
- `/health` check on port `3001`
- global backend service with logging enabled
- Google-managed SSL certificate for `enterprise.vaultproof.dev`
- modern TLS policy
- URL map, target HTTPS proxy, and global forwarding rule on port `443`

Verify the edge:

```bash
bash infra/gcp/enterprise-secure-runtime/verify-public-edge.sh
```

Before DNS points at the edge, certificate validation may require:

```bash
ALLOW_INSECURE=true bash infra/gcp/enterprise-secure-runtime/verify-public-edge.sh
```

After the script prints the edge IP, create or update this Cloudflare record:

```text
type: A
name: enterprise
value: <GCP edge IP>
proxy: DNS-only for first validation
```

## Customer Launch Gate

Run the local launch gate before asking a customer to test:

```bash
npm run gate:gcp-customer-launch
```

After gcloud auth, the public edge, DNS, and production readiness are complete, run the stricter live gate:

```bash
RUN_LIVE_EDGE=true \
RUN_LIVE_APP_QA=true \
RUN_LOGIN_QA=true \
RUN_CLOUD_ARMOR_QA=true \
STRICT_LIVE=true \
npm run gate:gcp-customer-launch
```
