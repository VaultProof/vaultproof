# VaultProof Customer-Managed KMS

Last updated: 2026-05-24

This is the first sellable customer-managed KMS lane for VaultProof Enterprise. It is intentionally scoped to Google Cloud KMS so a new customer can connect their own KMS key without a multi-cloud build.

## Supported V1 Shape

- Customer cloud: Google Cloud
- Customer key path: Cloud KMS crypto key
- VaultProof runtime: GCP confidential enterprise executor
- Runtime trust anchor: customer-owned Cloud KMS decrypt on the VaultProof unwrap root
- Provider key storage: encrypted provider-key shares in Supabase
- Provider key use: raw provider key is reconstructed only inside the secure executor process

Do not ask the customer to store raw provider keys in VaultProof, browser forms, CI, logs, or ordinary runtime env vars.

## Customer Prerequisites

Ask the customer for:

- The Cloud KMS crypto key resource:
  `projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>`
- The KMS key version to evidence, or permission to use the primary version.
- A KMS/IAM owner who can grant decrypt access during setup.
- The first provider API key owner.
- The first workload and rollback owner.

VaultProof needs only decrypt access to the KMS key for the executor identity:

```bash
gcloud kms keys add-iam-policy-binding "<key>" \
  --project="<customer-project>" \
  --location="<location>" \
  --keyring="<ring>" \
  --member="serviceAccount:vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com" \
  --role="roles/cloudkms.cryptoKeyDecrypter"
```

Use a dedicated runtime service account for a dedicated customer runtime when available. The command above shows the shared pilot executor identity.

## Preflight

Run preflight before changing runtime secrets:

```bash
CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE="projects/acme-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap" \
npm run preflight:gcp-customer-kms
```

That command verifies:

- The KMS resource parses cleanly.
- The key and key version can be described.
- The operator can encrypt and decrypt a temporary 32-byte unwrap root through the customer KMS key.
- The expected VaultProof executor identity is present on the key policy when visible, or emits a warning if access might be inherited elsewhere.

For a deployable ciphertext, provide the real unwrap root:

```bash
CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE="projects/acme-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap" \
VAULT_UNWRAP_KEY_BASE64="..." \
OUTPUT_FORMAT=env \
npm run preflight:gcp-customer-kms
```

The env output includes:

- `GCP_KMS_CRYPTO_KEY_RESOURCE`
- `GCP_KMS_KEY_VERSION`
- `GCP_KMS_PROTECTION_LEVEL`
- `GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64`

The command never prints the raw unwrap root.

## Runtime Env

The secure executor accepts either the original split KMS config:

```bash
GCP_PROJECT_ID=vaultproof-prod
GCP_LOCATION=us-central1
GCP_KMS_KEY_RING=vaultproof-runtime
GCP_KMS_KEY_NAME=vaultproof-unwrap
```

or the customer-managed explicit resource:

```bash
GCP_KMS_CRYPTO_KEY_RESOURCE=projects/acme-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap
```

When the explicit resource is present, the executor uses it as the KMS decrypt target and reports that customer key in private executor health evidence.

## Provider Key Sealing

The provider key must be sealed with the same raw unwrap root that was encrypted by the customer KMS key:

```bash
SUPABASE_URL="https://...supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
PROJECT_ID="..." \
PROVIDER="openai" \
PROVIDER_SLOT_SLUG="openai" \
UPSTREAM_BASE_URL="https://api.openai.com" \
VAULT_UNWRAP_KEY_BASE64="same root encrypted through customer KMS" \
PROVIDER_API_KEY_FILE="/path/to/provider-key.txt" \
npm run seal:enterprise-provider-slot
```

Use `DRY_RUN=true` first when targeting a real customer project.

## Launch Check

After publishing runtime env and sealing the first provider slot, run:

```bash
GOAL1_DEMO_ONLY=false \
npm run gate:gcp-first-goal
```

Then run one customer-approved dry execute or live execute test with the selected provider slot. The evidence packet should show:

- `key_release_mode: gcp-cloud-kms`
- `security_profile: google-confidential-production`
- the customer KMS key resource in private executor health
- sealed-live provider material
- no raw provider key, encrypted share, unwrap root, Supabase service-role key, origin-lock secret, signing secret, or runtime token in browser/customer packets

## Setup Time Target

With prerequisites ready, the target setup window is 2-4 hours:

1. Customer grants KMS decrypt to the VaultProof executor identity.
2. Operator runs customer KMS preflight.
3. Operator publishes runtime env with the customer KMS resource and encrypted unwrap root.
4. Operator seals the first provider key.
5. Operator runs readiness, dry execute, and first approved real execute.
6. Operator exports the customer evidence packet.

Private networking, mTLS, dedicated runtime, Azure KMS, HashiCorp Vault Transit, HSM, or external key manager support are later lanes. The AWS KMS lane has started in `docs/enterprise/aws-customer-managed-kms.md`.
