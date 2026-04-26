# VaultProof Enterprise Secure Runtime

This folder is the deployment starting point for the Azure-only enterprise secure executor.

It intentionally does **not** replace the B2C Cloudflare path.

## What This Creates

- Enterprise VNet with separate control-plane and executor subnets.
- Network Security Group for the executor subnet.
- Azure Confidential VM for the secure executor.
- Azure Key Vault Premium for the enterprise unwrap key.
- RSA-HSM unwrap key with `release` capability.
- Azure Attestation provider.
- Optional Azure API Management instance for API lifecycle governance.

API Management is for routing, rate limits, auth policy, observability, products, versions, and developer portal/catalog workflows. It must not reconstruct secrets or replace the Confidential VM executor.

The current template keeps a temporary public IP for SSH bootstrap. After the executor is installed and private routing is working, remove public SSH access.

## Deploy From Azure Cloud Shell

From the repo root after uploading/cloning the repo into Cloud Shell:

```bash
cd infra/azure/enterprise-secure-runtime
cp main.parameters.example.json main.parameters.json
```

Edit `main.parameters.json`:

- `location`: use a region where your subscription has DCasv5/DCesv5 Confidential VM SKUs. West US 2 may not have `Standard_DC2as_v5` for this subscription.
- `adminSshPublicKey`: your public SSH key.
- `sshSourceCidr`: your current public IP with `/32`.
- `environmentName`: keep short; Azure Key Vault names are globally unique and length-limited.
- `allowFrontDoorToControlPlane`: keep `false` until local VM readiness is production-ready. Set `true` for Front Door cutover to port `3001`.
- `controlPlaneIngressSource`: keep `AzureFrontDoor.Backend` for Front Door origin traffic.
- `deployPrototypeReleaseKey`: keep `false` for the first VM deployment. Enable it only after a real Secure Key Release policy exists.
- `deployManagedHsm`: set `true` when you are ready to create the final Managed HSM release-key home.
- `managedHsmInitialAdminObjectId`: required when `deployManagedHsm=true`. Get it with `az ad signed-in-user show --query id -o tsv`.
- `deployApiManagement`: keep `false` until you are ready to add APIM cost/governance.
- `apiManagementSkuName`: use `StandardV2` for production starter or `PremiumV2` when you need stronger isolation/networking features.

Check Confidential VM SKU availability before deploying:

```bash
for region in westus2 westus3 eastus eastus2 centralus southcentralus; do
  echo "== $region =="
  az vm list-skus \
    --location "$region" \
    --size Standard_DC \
    --all \
    --query "[?contains(name, 'DC') && contains(name, 'v5')].{name:name, zones:join(',', locationInfo[0].zones || [])}" \
    -o table
done
```

Pick a region that lists `Standard_DC2as_v5` or another DCasv5/DCesv5 SKU. If none appear, check whether the subscription has Confidential VM availability/quota in nearby regions:

```bash
az vm list-skus \
  --location eastus \
  --size Standard_EC \
  --all \
  --query "[?contains(name, 'v5')].name" \
  -o table
```

Do not silently switch to a normal D/E/B VM size. That would remove the Confidential VM security boundary.

Then deploy:

```bash
az deployment group create \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime \
  --template-file main.bicep \
  --parameters @main.parameters.json
```

After deployment, print the important outputs and next steps:

```bash
bash post-deploy-check.sh
```

## Bootstrap Executor On The VM

SSH to the VM using the deployment output public IP:

```bash
ssh azureuser@<confidentialVmPublicIp>
```

Copy the repo from Cloud Shell to the VM, then run the bootstrap script. This avoids putting GitHub credentials on the Confidential VM:

```bash
cd ~
tar --exclude node_modules --exclude .git --exclude .next --exclude dist -czf /tmp/vaultproof.tgz vaultproof
scp /tmp/vaultproof.tgz azureuser@<confidentialVmPublicIp>:/tmp/vaultproof.tgz
ssh azureuser@<confidentialVmPublicIp>
```

On the VM:

```bash
sudo mkdir -p /opt/vaultproof/zkvault
sudo tar -xzf /tmp/vaultproof.tgz -C /opt/vaultproof/zkvault --strip-components=1
sudo chown -R azureuser:azureuser /opt/vaultproof
cd /opt/vaultproof/zkvault
sudo bash infra/azure/enterprise-secure-runtime/bootstrap-confidential-vm.sh
```

If you prefer SSH deploy keys, you can also clone the private repo directly into `/opt/vaultproof/zkvault`.

`VAULT_ENCRYPTION_KEY` must not be used in confidential mode.

Fill in the service environment file:

```bash
sudo nano /etc/vaultproof/enterprise-secure-executor.env
```

Required values:

```bash
PORT=3002
VAULTPROOF_EXECUTOR_MODE=confidential
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS=enterprise-azure-v1:...
AZURE_KEY_RELEASE_URL=...
AZURE_ATTESTATION_PROVIDER_URI=...
AZURE_ATTESTATION_CLIENT_PATH=/usr/local/bin/AttestationClient
AZURE_KEY_RELEASE_POLICY_HASH=...
AZURE_KEY_ID=...
AZURE_KEY_VERSION=...
VAULTPROOF_EXECUTOR_BUILD_DIGEST=...
AZURE_CONFIDENTIAL_VM_RESOURCE_ID=...
AZURE_MEASUREMENT_SUMMARY=...
```

From Cloud Shell, you can render most of that env file from deployment outputs:

```bash
export SUPABASE_URL='https://...supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS='enterprise-azure-v1:...'
export VAULTPROOF_EXECUTOR_BUILD_DIGEST='sha256:...'
export AZURE_KEY_RELEASE_POLICY_HASH='sha256:...'
export AZURE_MEASUREMENT_SUMMARY='approved-vtpm-measurement'

bash render-executor-env.sh > enterprise-secure-executor.env
```

Review `enterprise-secure-executor.env`, then copy it to the Confidential VM:

```bash
scp enterprise-secure-executor.env azureuser@<confidentialVmPublicIp>:/tmp/enterprise-secure-executor.env
ssh azureuser@<confidentialVmPublicIp>
sudo install -o root -g vaultproof -m 0640 /tmp/enterprise-secure-executor.env /etc/vaultproof/enterprise-secure-executor.env
```

Do **not** use a static `AZURE_ATTESTATION_TOKEN` for production. Azure guest attestation tokens are short lived. The executor can generate a fresh token on demand by running the Azure Confidential VM guest attestation client from `AZURE_ATTESTATION_CLIENT_PATH`.

Install the Azure guest attestation client on the Confidential VM before starting the service. Microsoft documents the Linux flow as downloading/installing the guest attestation package and running:

```bash
sudo ./AttestationClient -a <attestation-provider-uri> -o token
```

For VaultProof production, the installed binary should be executable by the `vaultproof` service user without interactive sudo, for example:

```bash
sudo install -o root -g vaultproof -m 0750 ./AttestationClient /usr/local/bin/AttestationClient
sudo -u vaultproof /usr/local/bin/AttestationClient -a <attestation-provider-uri> -o token
```

Only use `AZURE_ATTESTATION_TOKEN=...` as a temporary debugging override. Remove it before claiming production hardware-bound key release.

Then start the service:

```bash
sudo systemctl start vaultproof-executor
sudo systemctl status vaultproof-executor --no-pager
```

## Co-Located Production Control Plane

For the strongest demo path, run the enterprise control plane on the same Confidential VM as the secure executor. The control plane then calls the executor over loopback:

```text
Azure Front Door + WAF
  -> enterprise control plane on Confidential VM :3001
  -> signed local handoff to 127.0.0.1:3002
  -> secure executor releases the HSM root only after MAA attestation
```

This avoids sending executor requests over public HTTP and lets `/readiness` validate the same production executor that handles real calls.

From your local machine, render the control-plane env:

```bash
cd infra/azure/enterprise-secure-runtime

export ENTERPRISE_HOSTNAME='enterprise.vaultproof.dev'
export ENTERPRISE_EXECUTOR_BASE_URL='http://127.0.0.1:3002'
export ENTERPRISE_EXECUTOR_SIGNING_KEY_ID='enterprise-azure-v1'
export ENTERPRISE_EXECUTOR_SIGNING_SECRET='...'
export SUPABASE_URL='https://...supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'

bash render-control-plane-env.sh > /tmp/enterprise-control-plane.env
scp /tmp/enterprise-control-plane.env azureuser@<confidentialVmPublicIp>:/tmp/enterprise-control-plane.env
```

On the Confidential VM:

```bash
sudo install -o root -g vaultproof -m 0640 /tmp/enterprise-control-plane.env /etc/vaultproof/enterprise-control-plane.env
sudo systemctl restart vaultproof-control-plane
curl -sS -H 'host: enterprise.vaultproof.dev' http://127.0.0.1:3001/readiness
```

Only after local readiness is production-ready should `enterprise.vaultproof.dev` be cut over from the Container App origin to the Confidential VM origin. At that point, restrict port `3001` to Azure Front Door origins and remove direct SSH/public executor access where possible.

### Front Door Cutover

Before cutover, enable only Front Door backend ingress to the VM control plane:

```bash
az deployment group create \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm \
  --template-file infra/azure/enterprise-secure-runtime/main.bicep \
  --parameters \
    location=eastus \
    environmentName=vpenteu \
    adminUsername=azureuser \
    adminSshPublicKey='<existing SSH public key>' \
    vmSize=Standard_DC2as_v5 \
    sshSourceCidr='<your current IPv4>/32' \
    executorSourceCidr=10.42.1.0/24 \
    allowFrontDoorToControlPlane=true \
    controlPlaneIngressSource=AzureFrontDoor.Backend \
    secureKeyReleasePolicyData='' \
    deployPrototypeReleaseKey=false \
    deployManagedHsm=true \
    managedHsmInitialAdminObjectId='<your Entra object id>' \
    deployApiManagement=false
```

Then in Azure Front Door:

- Add a new origin pointing to the Confidential VM public IP.
- Set origin host header to `enterprise.vaultproof.dev`.
- Set origin protocol to HTTP and origin port to `3001` for the current VM service.
- Keep the old Container App origin available as rollback until `/readiness` is production-ready through Front Door.
- After validation, move `default-route` traffic to the VM origin.

Rollback is simply moving the route back to the Container App origin in Front Door.

## Secure Key Release Work Still Required

The first deployment can create Key Vault and Attestation resources, but the final release policy must be pinned to real Confidential VM attestation claims.

The Bicep template can create a Key Vault Premium `RSA-HSM` key as the prototype Secure Key Release path, but it is disabled by default because release keys require a valid release policy. The first deployment should create the VM, VNet, Key Vault, and Attestation provider only.

After the VM is booted and attestation claims are known, create a release policy and either:

- set `deployPrototypeReleaseKey=true` with `secureKeyReleasePolicyData`, then redeploy the prototype key, or
- use the final Azure Managed HSM `RSA-HSM` release-root path.

The final AES-256 production design uses Azure Managed HSM with an exportable `RSA-HSM` key release policy. Azure does not allow generated symmetric `oct-HSM` keys to be exported/released. VaultProof releases the RSA-HSM private JWK only to the attested Confidential VM, then derives the AES-256 unwrap root inside that VM. See `managed-hsm-oct-hsm-notes.md`.

### Build The Strict Production SKR Policy

On the Confidential VM, generate a fresh MAA token with the guest attestation client:

```bash
sudo -u vaultproof /usr/local/bin/AttestationClient \
  -a https://<attestation-provider>.attest.azure.net \
  -n "$(uuidgen)" \
  -o token | tee /tmp/vaultproof-maa-token.jwt
```

Copy the token back to Cloud Shell:

```bash
scp azureuser@<confidentialVmPublicIp>:/tmp/vaultproof-maa-token.jwt /tmp/vaultproof-maa-token.jwt
```

Build the strict VM-bound release policy:

```bash
cd ~/vaultproof/infra/azure/enterprise-secure-runtime
node build-skr-policy.mjs \
  --token-file /tmp/vaultproof-maa-token.jwt \
  --out-dir /tmp/vaultproof-skr \
  --mode strict-vm
```

`strict-vm` pins the policy to the current Confidential VM's MAA issuer, SEV-SNP type, Azure-compliant CVM status, secure boot, vTPM, disabled debug flags, VM unique ID, and SEV-SNP launch measurement. For HA, generate one policy entry per production executor VM.

### Create The Final Managed HSM Key

If Managed HSM was not deployed yet, set these in `main.parameters.json` and redeploy:

```json
"deployManagedHsm": { "value": true },
"managedHsmInitialAdminObjectId": { "value": "<your Entra object id>" }
```

Then create the release key and grant only release access to the Confidential VM managed identity:

```bash
export MANAGED_HSM_NAME='<managedHsmName output>'
export POLICY_FILE='/tmp/vaultproof-skr/skr-policy.json'
export VM_PRINCIPAL_ID='<confidentialVmPrincipalId output>'

bash provision-managed-hsm-release-key.sh
```

Load the generated key and policy env, then render the executor env:

```bash
source /tmp/vaultproof-skr/skr-env.sh
source ./managed-hsm-key-env.sh

export DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus
export SUPABASE_URL='https://...supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS='enterprise-azure-v1:...'
export VAULTPROOF_EXECUTOR_BUILD_DIGEST="sha256:$(tar --exclude node_modules --exclude .git --exclude dist -cf - ~/vaultproof | sha256sum | awk '{print $1}')"

bash render-executor-env.sh > /tmp/enterprise-secure-executor.env
scp /tmp/enterprise-secure-executor.env azureuser@<confidentialVmPublicIp>:/tmp/enterprise-secure-executor.env
```

On the Confidential VM:

```bash
sudo install -o root -g vaultproof -m 0640 /tmp/enterprise-secure-executor.env /etc/vaultproof/enterprise-secure-executor.env
sudo systemctl restart vaultproof-executor
curl -sS http://localhost:3002/health
```

Flow:

1. Boot the Confidential VM.
2. Install and test the Azure guest attestation client inside the VM.
3. Generate guest attestation evidence inside the VM.
4. Create the Secure Key Release policy from the attested claims.
5. Update the Key Vault or Managed HSM key release policy.
6. Grant the VM managed identity `release` permission for the key.
7. Start the executor with `VAULTPROOF_EXECUTOR_MODE=confidential`.
8. Confirm `/health.production_ready` is `true`.

Until all steps are complete, `VAULTPROOF_EXECUTOR_MODE=confidential` fails closed by design.

## API Management Placement

Target production route:

```text
enterprise.vaultproof.dev
  -> Azure Front Door + WAF
  -> Azure API Management
  -> Enterprise Control Plane
  -> private signed handoff
  -> Azure Confidential VM Executor
```

APIM policy starts with coarse limits:

- 120 calls per minute per IP.
- 10,000 calls per day per IP.
- Adds `x-vaultproof-apim: enterprise`.

Later policies should add JWT validation, Entra-aware products/subscriptions, request size limits, per-customer quotas, OpenAPI publishing, and Azure Monitor/Application Insights integration.

## Lockdown Checklist

- Remove the bootstrap public IP or close SSH after setup.
- Route control plane to executor over private IP.
- Restrict executor NSG source to the control-plane subnet or private endpoint.
- Remove `ENTERPRISE_DEMO_SEED_TOKEN`.
- Keep `VAULT_ENCRYPTION_KEY` unset in production.
- Keep `AZURE_ATTESTATION_TOKEN` unset in production unless debugging a failed attestation flow.
- Confirm `AZURE_ATTESTATION_CLIENT_PATH` points to an executable guest attestation client.
- Confirm `/health` reports `key_release_mode: azure-secure-key-release`.
- Confirm `/health` reports `key_release_hardware_bound: true`.
- Confirm `/health` reports `attestation_evidence_ready: true`.
- Confirm `/health` reports `production_ready: true`.
- Confirm `/health` reports `production_blockers: []`.

`production_ready` intentionally fails closed. It requires:

- `VAULTPROOF_EXECUTOR_MODE=confidential`
- `AZURE_KEY_RELEASE_URL`
- `AZURE_ATTESTATION_PROVIDER_URI`
- `AZURE_ATTESTATION_CLIENT_PATH`
- no static `AZURE_ATTESTATION_TOKEN`
- hardware-bound `azure-secure-key-release` mode
- attestation token hash in the evidence bundle
- Secure Key Release policy hash
- released key ID and version
- executor build digest
- Confidential VM resource ID
- Azure MAA and Azure Confidential VM claim summary
- measurement summary
- replay protection
