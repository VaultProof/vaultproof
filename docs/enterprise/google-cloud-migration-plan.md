# Google Cloud Migration Plan

Last updated: 2026-05-08

## Goal

Move VaultProof Enterprise off Azure and rebuild the most-secure runtime on Google Cloud while preserving the core trust model:

- user/org/project authorization in the control plane,
- signed execution envelopes,
- replay protection,
- confidential compute for provider execution,
- non-exportable Cloud KMS key control for the shared pilot,
- audit/evidence metadata that customers can inspect.

## Important Difference From Azure

Azure currently uses Secure Key Release with an exportable `RSA-HSM` key path, then derives unwrap material inside the Confidential VM.

Google Cloud KMS is not a 1:1 replacement for Azure Secure Key Release. Cloud KMS key material cannot be viewed or exported; it is used through KMS APIs by authorized identities. For GCP, prefer one of these designs:

1. **Cost-controlled pilot:** Compute Engine Confidential VM + standard Cloud KMS decrypt calls from the executor service account. Keep decrypted material only in process memory with short TTL.
2. **Stronger attested release model:** Confidential Space container + Google Cloud Attestation + Workload Identity Federation conditions to grant KMS access only to the expected workload image/TEE.
3. **Future high-trust customer mode:** customer-owned Cloud KMS, optional Cloud HSM, or external key manager, with policy and audit requirements negotiated per customer.

## Azure To GCP Mapping

| Azure component | GCP target | Notes |
| --- | --- | --- |
| Azure Confidential VM | Compute Engine Confidential VM | Use Confidential VM for the first lift. Use Confidential Space if we need stronger image-bound attestation before KMS access. |
| Azure Managed HSM / Key Vault Premium SKR | Standard Cloud KMS for the shared pilot; optional Cloud HSM later | Do not assume raw key export. Avoid HSM in the shared pilot unless explicitly approved. |
| Azure Attestation / SKR policy hash | Google Cloud Attestation / Confidential Space token claims | Evidence model must be redesigned around GCP attestation tokens and workload identity attributes. |
| Azure Front Door | External HTTPS Load Balancer + Cloud Armor | Map `enterprise.vaultproof.dev` after DNS cutover. Staff/admin pages stay in the separate `vaultproof.dev` root/B2C system. |
| Azure API Management | API Gateway, Apigee, or customer gateway | For lowest cost, start without Apigee. Add API Gateway/Apigee only if needed for customer-managed gateway, quotas, and enterprise policy packaging. |
| Azure Monitor / App Insights | Cloud Logging, Cloud Monitoring, uptime checks, alert policies | Preserve readiness/health/attestation drift alerts. |
| Azure VM systemd deployment | Compute Engine VM systemd deployment or containerized Confidential Space workload | First lift can keep systemd. Confidential Space will require containerizing the executor/control-plane split. |
| Azure Key Vault/env files | Secret Manager + sealed operator backup | Keep Supabase/service-role/API secrets out of git. |

## Minimum GCP Architecture

1. Create a new GCP project and billing budget/alerts.
2. Enable APIs:
   - Compute Engine
   - Cloud KMS
   - Secret Manager
   - Cloud Logging
   - Cloud Monitoring
   - Artifact Registry if using containers
   - Confidential Computing APIs if using Confidential Space
3. Create service accounts:
   - `vaultproof-control-plane`
   - `vaultproof-executor`
   - optional `vaultproof-deploy`
4. Create Cloud KMS key ring and standard KMS key for unwrap/decrypt.
5. Deploy a small Compute Engine Confidential VM first.
6. Install Node.js and deploy this repo from GitHub/local source.
7. Restore or rotate runtime env values into Secret Manager and VM env files.
8. Wire external HTTPS load balancer for `enterprise.vaultproof.dev`.
9. Keep VaultProof staff/admin pages out of `enterprise.vaultproof.dev`; wire any staff tooling through the separate root/B2C admin system.
10. Run:

```bash
npm run test:enterprise-control-plane-smoke
npm run gate:gcp-customer-launch
RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true STRICT_LIVE=true npm run gate:gcp-customer-launch
```

## Code Changes Needed

Add a GCP runtime provider alongside Azure rather than replacing Azure code in place.

Suggested slices:

1. Add `ENTERPRISE_CLOUD_PROVIDER=azure|gcp`.
2. Add executor config for:
   - `GCP_PROJECT_ID`
   - `GCP_LOCATION`
   - `GCP_KMS_KEY_RING`
   - `GCP_KMS_KEY_NAME`
   - `GCP_KMS_KEY_VERSION`
   - `GCP_ATTESTATION_EXPECTED_IMAGE_DIGEST` or Confidential Space equivalent.
3. Add a GCP KMS unwrap/decrypt adapter in `packages/enterprise-secure-executor`.
4. Keep the same in-memory TTL cache behavior used by Azure release material.
5. Extend `/health` and `/readiness` to report:
   - `security_profile: google-confidential-production`
   - KMS readiness
   - attestation evidence summary
   - production blockers.
6. Extend audit metadata to include:
   - GCP project/location,
   - KMS key resource/version,
   - attestation token hash/claims summary,
   - executor build digest,
   - Confidential VM or Confidential Space identity.
7. Add GCP smoke tests with KMS calls mocked locally.
8. Add GCP deployment scripts under `infra/gcp/enterprise-secure-runtime/`.

## What To Keep From Azure Before Closing

Do not commit secrets to git. Save the following in a private operator vault if continuity matters:

- `/etc/vaultproof/enterprise-control-plane.env`
- `/etc/vaultproof/enterprise-secure-executor.env`
- `/etc/vaultproof/tls/*`
- Supabase URL, anon key, service-role key, and rotation notes
- Azure readiness/evidence outputs for comparison
- DNS/Front Door custom-domain settings for future DNS migration reference

If these are lost, recreate/rotate them in GCP instead of trying to recover old Azure state.

## Cost Controls

- Start with one small Confidential VM and standard Cloud KMS only.
- Do not create Apigee until the gateway business requirement is clear.
- Avoid per-demo GCP runtimes. Use one shared demo runtime and isolate with Supabase organizations/projects.
- Set a GCP budget and alerts before creating compute or load-balancing resources.
- Keep old Azure canceled/closed once backups are captured.

## First Implementation Order

1. Backup Azure runtime env/cert material.
2. Close/cancel Azure billing path.
3. Create GCP project and budget.
4. Add GCP executor config types and mocked KMS adapter.
5. Add `google-confidential-production` readiness path with mocked tests.
6. Create `infra/gcp/enterprise-secure-runtime/README.md` and deploy scripts.
7. Deploy first GCP Confidential VM.
8. Wire DNS/load balancer.
9. Publish real runtime secret versions and reset the VM.
10. Run public QA and the GCP customer launch gate.
11. Add attestation-bound Confidential Space/KMS policy once the basic lift is stable.

## Official GCP References

- Confidential VM: https://cloud.google.com/compute/docs/about-confidential-vm
- Confidential Space: https://cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview
- Google Cloud Attestation: https://cloud.google.com/confidential-computing/docs/attestation
- Cloud HSM: https://cloud.google.com/kms/docs/hsm
- Cloud KMS encrypt/decrypt: https://cloud.google.com/kms/docs/encrypt-decrypt
- Confidential Space deployment roles: https://cloud.google.com/confidential-computing/confidential-space/docs/deploy-workloads
