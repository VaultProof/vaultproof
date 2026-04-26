# Managed HSM `oct-HSM` Production Notes

The Bicep template currently creates an Azure Key Vault Premium `RSA-HSM` key as the lower-friction Secure Key Release prototype path.

For the final VaultProof Enterprise AES-256 story, use Azure Managed HSM with an `oct-HSM` 256-bit key and Secure Key Release policy.

Microsoft docs confirm:

- Azure Key Vault vaults support RSA and EC key types.
- Managed HSM supports RSA, EC, and symmetric keys.
- `oct-HSM` is supported only by Managed HSM, with 128-bit, 192-bit, and 256-bit key sizes.
- Managed HSM keys are FIPS 140-3 Level 3 HSM protected.

Useful official docs:

- https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys
- https://learn.microsoft.com/en-us/cli/azure/keyvault/key
- https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/key-management

## Target Production Shape

```text
Azure Confidential VM executor
  -> Microsoft Azure Attestation token
  -> Azure Managed HSM release API
  -> released oct-HSM 256-bit unwrap material
  -> decrypt encrypted shares in confidential runtime
```

## Create The Production Key

After the Managed HSM exists and is activated, create the key with a release policy:

```bash
az keyvault key create \
  --hsm-name <managed-hsm-name> \
  --name vaultproof-enterprise-unwrap \
  --kty oct-HSM \
  --size 256 \
  --ops release \
  --exportable true \
  --policy @skr-policy.json
```

The resulting release URL shape should be:

```text
https://<managed-hsm-name>.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/<version>/release
```

Use that value for:

```bash
AZURE_KEY_RELEASE_URL=...
AZURE_KEY_ID=https://<managed-hsm-name>.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/<version>
AZURE_KEY_VERSION=<version>
```

## Access Control

Managed HSM uses local RBAC for data-plane permissions. The Confidential VM system-assigned managed identity must be allowed to release the key.

At minimum, grant only the role/permission needed for key release to the VM principal ID. Avoid broad admin roles for the executor identity.

The VM principal ID is emitted by the Bicep deployment as:

```text
confidentialVmPrincipalId
```

## Policy Requirements

The release policy must be pinned to real Azure Confidential VM attestation claims.

Do not use:

- a permissive sample policy
- a debug/insecure attestation mode
- a static `AZURE_ATTESTATION_TOKEN`
- `VAULT_ENCRYPTION_KEY`

The executor should only report production readiness when:

```json
{
  "key_release_mode": "azure-secure-key-release",
  "key_release_hardware_bound": true,
  "attestation_evidence_ready": true,
  "production_ready": true,
  "production_blockers": []
}
```

