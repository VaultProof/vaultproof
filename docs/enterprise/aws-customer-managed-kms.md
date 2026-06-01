# VaultProof AWS Customer-Managed KMS

Last updated: 2026-05-24

This is the first AWS customer-managed KMS lane for VaultProof Enterprise. It mirrors the GCP lane: AWS KMS protects the VaultProof unwrap root, and VaultProof stores only encrypted provider-key shares.

## Supported V1 Shape

- Customer cloud: AWS
- Customer key path: AWS KMS symmetric key
- Runtime trust anchor: customer-owned AWS KMS `Decrypt` on the VaultProof unwrap root
- Preferred runtime isolation: AWS Nitro Enclave
- Provider key storage: encrypted provider-key shares in Supabase
- Provider key use: raw provider key is reconstructed only inside the secure executor process

The runtime provider supports AWS KMS direct API calls with SigV4. Credentials come from explicit runtime env only for testing/bootstrap, or from the EC2 instance metadata role in production.

## Customer Prerequisites

Ask the customer for:

- AWS KMS key ARN or key ID.
- AWS region.
- Runtime IAM role ARN that will run VaultProof executor.
- A security/IAM owner who can grant `kms:Decrypt`.
- The first provider API key owner.
- The first workload and rollback owner.

The customer KMS policy or IAM policy must allow the runtime role to decrypt:

```json
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:us-east-1:111122223333:key/..."
}
```

For stricter deployments, bind decrypt permission to expected role/session conditions and Nitro Enclave attestation when available.

## Admin Onboarding Flow

VaultProof stores each customer KMS setup under that business' `organization_id`. That is the tenant boundary: Acme's AWS KMS ARN, role ARN, and `external_id` live on Acme's organization record; another business gets a separate row and a separate `external_id`.

In the internal admin console, open the business detail page and save the AWS KMS connection with:

- AWS account ID
- AWS region
- AWS KMS key ARN
- Customer IAM role ARN
- VaultProof-generated `external_id`

The admin response includes a customer trust-policy template using the VaultProof AWS runtime principal and that business' `external_id`. Do not enter AWS access keys, AWS secret access keys, session tokens, provider API keys, or private key material in this form.

The database table for this flow is `organization_kms_connections`. Writes are approval-gated internal admin actions; customer org admins can read their own KMS onboarding status for evidence and handoff.

Staff page shape:

- `https://admin.vaultproof.dev/orgs/<organization_id>` is the VaultProof staff page for one business.
- `https://enterprise.vaultproof.dev/app/login?org=<organization_id>` is the customer login link for that same business.
- `GET /api/v1/enterprise/orgs/current/kms-connections` returns only the signed-in business' KMS status to allowed org admins/auditors.

## Preflight

Run preflight before changing runtime secrets:

```bash
CUSTOMER_AWS_KMS_KEY_ID="arn:aws:kms:us-east-1:111122223333:key/..." \
CUSTOMER_AWS_RUNTIME_ROLE_ARN="arn:aws:iam::111122223333:role/vaultproof-executor" \
npm run preflight:aws-customer-kms
```

That command verifies:

- The AWS KMS key can be described.
- The key is enabled and usable for encrypt/decrypt.
- The operator can encrypt and decrypt a temporary 32-byte unwrap root through the customer key.
- Runtime role decrypt access can be simulated when the caller has permission to use IAM policy simulation.

For a deployable ciphertext, provide the real unwrap root:

```bash
CUSTOMER_AWS_KMS_KEY_ID="arn:aws:kms:us-east-1:111122223333:key/..." \
VAULT_UNWRAP_KEY_BASE64="..." \
OUTPUT_FORMAT=env \
npm run preflight:aws-customer-kms
```

The env output includes:

- `ENTERPRISE_CLOUD_PROVIDER=aws`
- `AWS_REGION`
- `AWS_KMS_KEY_ID`
- `AWS_KMS_KEY_ARN`
- `AWS_KMS_KEY_SPEC`
- `AWS_KMS_KEY_USAGE`
- `AWS_KMS_KEY_STATE`
- `AWS_KMS_KEY_ORIGIN`
- `AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64`

The command never prints the raw unwrap root.

## Runtime Env

The secure executor reads:

```bash
ENTERPRISE_CLOUD_PROVIDER=aws
VAULTPROOF_EXECUTOR_MODE=confidential
AWS_REGION=us-east-1
AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:111122223333:key/...
AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64=...
AWS_KMS_KEY_SPEC=SYMMETRIC_DEFAULT
AWS_KMS_KEY_USAGE=ENCRYPT_DECRYPT
AWS_KMS_KEY_STATE=Enabled
AWS_KMS_KEY_ORIGIN=AWS_KMS
AWS_ISOLATION_PROVIDER=aws-nitro-enclave
AWS_ROLE_ARN=arn:aws:iam::111122223333:role/VaultProofCustomerKmsRole
AWS_EXTERNAL_ID=vaultproof-org123-...
AWS_ATTESTATION_TOKEN_HASH=...
AWS_CONFIDENTIAL_VM_RESOURCE_ID=...
AWS_MEASUREMENT_SUMMARY=...
```

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` are supported for local/bootstrap tests. Production should use the runtime role through instance metadata. When `AWS_ROLE_ARN` is set, the executor assumes that customer role before calling AWS KMS; when `AWS_EXTERNAL_ID` is also set, it sends that value in the STS `AssumeRole` request.

## Provider Key Sealing

The provider key must be sealed with the same raw unwrap root encrypted by AWS KMS:

```bash
SUPABASE_URL="https://...supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
PROJECT_ID="..." \
PROVIDER="openai" \
PROVIDER_SLOT_SLUG="openai" \
UPSTREAM_BASE_URL="https://api.openai.com" \
VAULT_UNWRAP_KEY_BASE64="same root encrypted through AWS KMS" \
PROVIDER_API_KEY_FILE="/path/to/provider-key.txt" \
npm run seal:enterprise-provider-slot
```

Use `DRY_RUN=true` first when targeting a real customer project.

## Launch Check

After publishing runtime env and sealing the first provider slot, the executor private health should show:

- `key_release_mode: aws-kms`
- `security_profile: aws-kms-confidential-production`
- AWS key ARN/state/spec/origin in private key-release evidence
- `provider: aws-nitro-enclave`
- sealed-live provider material

Customer packets must still exclude raw provider keys, encrypted shares, unwrap roots, AWS access keys, Supabase service-role keys, origin-lock secrets, signing secrets, and runtime tokens.

## Setup Time Target

With prerequisites ready, the target setup window is 2-4 hours:

1. Customer grants `kms:Decrypt` to the VaultProof runtime role.
2. Operator runs AWS KMS preflight.
3. Operator publishes runtime env with the customer KMS key and encrypted unwrap root.
4. Operator seals the first provider key.
5. Operator runs readiness, dry execute, and first approved real execute.
6. Operator exports the customer evidence packet.
