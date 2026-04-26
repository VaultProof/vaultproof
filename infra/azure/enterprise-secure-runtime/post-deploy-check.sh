#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Run this from Azure Cloud Shell or a machine with az installed." >&2
  exit 1
fi

deployment_output() {
  local name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${name}.value" \
    -o tsv
}

vm_name="$(deployment_output confidentialVmName)"
vm_public_ip="$(deployment_output confidentialVmPublicIp)"
vm_private_ip="$(deployment_output confidentialVmPrivateIp)"
vm_principal_id="$(deployment_output confidentialVmPrincipalId)"
key_release_url="$(deployment_output prototypeKeyReleaseUrl)"
attestation_uri="$(deployment_output attestationProviderUri)"
managed_hsm_name="$(deployment_output managedHsmName)"
managed_hsm_uri="$(deployment_output managedHsmUri)"

echo "VaultProof enterprise secure runtime deployment:"
echo "  VM name:             ${vm_name}"
echo "  VM public IP:        ${vm_public_ip}"
echo "  VM private IP:       ${vm_private_ip}"
echo "  VM principal ID:     ${vm_principal_id}"
echo "  Key release URL:     ${key_release_url}"
echo "  Attestation URI:     ${attestation_uri}"
echo "  Managed HSM name:    ${managed_hsm_name}"
echo "  Managed HSM URI:     ${managed_hsm_uri}"
echo

echo "VM security profile:"
az vm show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${vm_name}" \
  --query "{securityType:securityProfile.securityType,secureBoot:securityProfile.uefiSettings.secureBootEnabled,vTpm:securityProfile.uefiSettings.vTpmEnabled,identity:identity.type}" \
  -o table

echo
echo "Next manual steps:"
echo "1. SSH to the VM: ssh azureuser@${vm_public_ip}"
echo "2. Install/test the Azure guest attestation client."
echo "3. Build a strict SKR policy from the VM attestation token."
echo "4. Create the Managed HSM oct-HSM release key and grant the VM release-only access."
echo "5. Run render-executor-env.sh from Cloud Shell and copy output to /etc/vaultproof/enterprise-secure-executor.env."
echo "6. Start vaultproof-executor and confirm /health.production_ready is true."
