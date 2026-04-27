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
- `allowFrontDoorToTlsControlPlane`: keep `false` until the TLS origin proxy is installed and tested. Set `true` when preparing Front Door `HttpsOnly` origin forwarding to port `443`.
- `controlPlaneIngressSource`: keep `AzureFrontDoor.Backend` for Front Door origin traffic. When enabled, the template also allows `AzureFrontDoor.Frontend` and `AzureFrontDoor.FirstParty`, which are required by some Front Door health/request paths.
- `allowApiManagementToControlPlane`: keep `false` until APIM is deployed and the Confidential VM control plane is configured to trust the APIM origin-lock secret or forwarded Front Door ID.
- `apiManagementIngressSource`: default is `ApiManagement`; use a tighter CIDR/source only if you know the APIM outbound path.
- `deployPrototypeReleaseKey`: keep `false` for the first VM deployment. Enable it only after a real Secure Key Release policy exists.
- `deployManagedHsm`: set `true` when you are ready to create the final Managed HSM release-key home.
- `managedHsmInitialAdminObjectId`: required when `deployManagedHsm=true`. Get it with `az ad signed-in-user show --query id -o tsv`.
- `deployApiManagement`: keep `false` until you are ready to add APIM cost/governance.
- `apiManagementSkuName`: use `StandardV2` for production starter or `PremiumV2` when you need stronger isolation/networking features.
- `apiManagementBackendUrl`: leave empty to forward to the Confidential VM public control-plane origin on port `3001`, or set it to a private/internal origin once that exists.
- `apiManagementOriginLockSecret`: optional APIM-to-control-plane shared origin-lock secret. If set, also set `ENTERPRISE_ORIGIN_LOCK_SECRET` in the control-plane env.
- `apiManagementJwtValidationEnabled`: enable APIM bearer-token validation before traffic reaches the control plane.
- `apiManagementJwtOpenIdConfigUrl`: OpenID metadata URL for APIM `validate-jwt`, such as Entra ID tenant metadata or another OpenID-compatible session provider.
- `apiManagementJwtIssuer` / `apiManagementJwtAudiences`: optional APIM issuer/audience allowlist checks.
- `deployMonitoring`: keep `false` until the Front Door production path is stable and you are ready to pay for Azure Monitor/App Insights resources.
- `monitoringAlertEmail` / `monitoringWebhookUrl`: optional Azure Monitor action group receivers.
- `monitoringEnterpriseUrl`: the public Front Door URL monitored by availability tests.

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

After the first bootstrap, deploy code updates from your local checkout with:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
VERIFY_AFTER_DEPLOY=true \
npm run deploy:enterprise-vm
```

The deploy helper copies the repo without build artifacts, preserves `/etc/vaultproof/*.env`, rebuilds the enterprise workspaces on the VM, reinstalls the systemd units, restarts the executor and control plane, and optionally runs the production verifier.

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
AZURE_KEY_RELEASE_CACHE_TTL_MS=60000
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
export AZURE_KEY_RELEASE_CACHE_TTL_MS=60000

bash render-executor-env.sh > enterprise-secure-executor.env
```

`AZURE_KEY_RELEASE_CACHE_TTL_MS` controls only in-process released unwrap material caching. The executor clamps it to a short maximum of five minutes and defaults to 60 seconds.

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
export ENTERPRISE_AZURE_FRONT_DOOR_ID="$(az afd profile show \
  --resource-group vaultproof-enterprise \
  --profile-name vaultproof-enterprise-fd \
  --query frontDoorId \
  -o tsv)"
export ENTERPRISE_REQUIRE_ORIGIN_LOCK=true
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

Azure Front Door automatically sends `X-Azure-FDID` to origins. The control plane validates that header against `ENTERPRISE_AZURE_FRONT_DOOR_ID` when `ENTERPRISE_REQUIRE_ORIGIN_LOCK=true`.
If you need to deploy the control-plane code before Front Door is fully configured, temporarily keep `ENTERPRISE_REQUIRE_ORIGIN_LOCK=false`.

Enterprise users land on a separate dashboard served by the Azure control plane:

- `https://enterprise.vaultproof.dev/app` and `/app/dashboard`: enterprise dashboard, runtime posture, org summary, project health, access, and audit.
- `https://enterprise.vaultproof.dev/app/control`: detailed policy and provider override control.
- `https://enterprise.vaultproof.dev/app/org`: organization and SSO settings.

The enterprise dashboard is not the B2C dashboard shell. It calls only the enterprise control-plane APIs under `/api/v1/enterprise/*`.

To create a temporary enterprise demo login for dashboard testing, run this from your local checkout with the Supabase service role key in your shell environment:

```bash
SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
DEMO_EMAIL='enterprise-demo+test@vaultproof.dev' \
npm run seed:enterprise-demo-account
```

The helper confirms the Supabase Auth user, creates/reuses a team organization, assigns owner membership, creates a sample enterprise project, and seeds dashboard-only sample audit/runtime rows. Set `DEMO_PASSWORD='...'` if you want a fixed password; otherwise it prints a generated one once. Delete or rotate the demo user after testing.

Only after local readiness is production-ready should `enterprise.vaultproof.dev` be cut over from the Container App origin to the Confidential VM origin. At that point, restrict port `3001` to Azure Front Door origins and close public SSH bootstrap access when another operational access path is ready.

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
    allowSshBootstrap=true \
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

Rollback is simply moving the route back to the Container App origin in Front Door while the prototype resources still exist.

### Old Container Apps Prototype Cleanup

After the Confidential VM path is stable and Front Door no longer has an enabled `*.azurecontainerapps.io` origin, inventory and retire the old Container Apps prototype path. The cleanup helper defaults to read-only inventory:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
npm run cleanup:enterprise-container-apps
```

Disable public ingress on the old Container Apps first. This is the recommended reversible cleanup step before deletion:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
ENTERPRISE_URL=https://enterprise.vaultproof.dev \
ACTION=disable-ingress \
npm run cleanup:enterprise-container-apps
```

If rollback needs the old Container Apps endpoint again, restore external ingress:

```bash
ACTION=restore-ingress \
npm run cleanup:enterprise-container-apps
```

The script refuses to disable or delete the prototype path unless:

- `enterprise.vaultproof.dev/readiness` reports `production_ready: true`.
- Front Door has no enabled `*.azurecontainerapps.io` origin in the active origin group.

After a soak period, explicitly delete the old apps and then the environment if it is dedicated to VaultProof:

```bash
ACTION=delete-apps npm run cleanup:enterprise-container-apps
ACTION=delete-environment npm run cleanup:enterprise-container-apps
```

Only delete the ACR if no other deployment path uses it:

```bash
ACTION=delete-acr npm run cleanup:enterprise-container-apps
```

### TLS Origin Cutover

The current production path is intentionally verifiable while Front Door forwards HTTP to the VM origin. The next hardening step is TLS between Front Door and the Confidential VM origin:

```text
Azure Front Door
  -> HTTPS :443 on the Confidential VM origin proxy
  -> HTTP loopback to enterprise control plane :3001
  -> HTTP loopback to secure executor :3002
```

Use a dedicated origin hostname for the VM, for example `origin.enterprise.vaultproof.dev`, with DNS pointing to the Confidential VM public IP. Install a publicly trusted certificate on the VM whose subject/SAN matches that origin hostname. This lets Front Door certificate subject validation stay enabled. Avoid using `enterprise.vaultproof.dev` as the origin hostname once Front Door owns that public route, or you risk routing/certificate confusion.

Copy the certificate and key to the VM:

```bash
sudo mkdir -p /etc/vaultproof/tls
sudo install -o root -g root -m 0644 origin.enterprise.vaultproof.dev.crt /etc/vaultproof/tls/origin.crt
sudo install -o root -g root -m 0600 origin.enterprise.vaultproof.dev.key /etc/vaultproof/tls/origin.key
```

Install the TLS proxy on the Confidential VM:

```bash
sudo ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
  ENTERPRISE_HOSTNAME=enterprise.vaultproof.dev \
  TLS_CERT_PATH=/etc/vaultproof/tls/origin.crt \
  TLS_KEY_PATH=/etc/vaultproof/tls/origin.key \
  /usr/local/sbin/vaultproof-install-origin-tls-proxy
```

For a temporary lab-only test, the installer can generate a self-signed certificate:

```bash
sudo ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
  ENTERPRISE_HOSTNAME=enterprise.vaultproof.dev \
  GENERATE_SELF_SIGNED=true \
  /usr/local/sbin/vaultproof-install-origin-tls-proxy
```

Do not enable Front Door certificate subject validation with the temporary self-signed certificate.

Validate local TLS before touching Front Door:

```bash
curl -sS \
  --resolve origin.enterprise.vaultproof.dev:443:127.0.0.1 \
  https://origin.enterprise.vaultproof.dev/health
```

Open port `443` to Azure Front Door in the NSG:

```bash
az deployment group create \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm-tls-origin \
  --template-file infra/azure/enterprise-secure-runtime/main.bicep \
  --parameters \
    location=eastus \
    environmentName=vpenteu \
    adminUsername=azureuser \
    adminSshPublicKey='<existing SSH public key>' \
    vmSize=Standard_DC2as_v5 \
    sshSourceCidr='<your current IPv4>/32' \
    allowSshBootstrap=true \
    executorSourceCidr=10.42.1.0/24 \
    allowFrontDoorToControlPlane=true \
    allowFrontDoorToTlsControlPlane=true \
    controlPlaneIngressSource=AzureFrontDoor.Backend \
    deployPrototypeReleaseKey=false \
    deployManagedHsm=true \
    managedHsmInitialAdminObjectId='<your Entra object id>' \
    deployApiManagement=false
```

Then preview the Front Door cutover:

```bash
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run cutover:enterprise-origin-tls
```

Enable the Front Door TLS origin cutover only after readiness, DNS, certificate, and local TLS checks pass:

```bash
ACTION=enable \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
RUN_VERIFIER=true \
npm run cutover:enterprise-origin-tls
```

By default the cutover helper SSHes to the VM and verifies `https://origin.enterprise.vaultproof.dev/health` against `127.0.0.1` before changing Front Door. If SSH has already been locked down and you have independently verified local origin TLS, set `SKIP_ORIGIN_TLS_CHECK=true`.

The helper updates the configured Front Door origin and route to:

- Origin host name: `origin.enterprise.vaultproof.dev`
- Origin host header: `origin.enterprise.vaultproof.dev`
- HTTPS port: `443`
- Certificate subject name validation: enabled
- Route forwarding protocol: `HttpsOnly`

The TLS proxy rewrites `Host` and `X-Forwarded-Host` to `enterprise.vaultproof.dev` before handing traffic to the Node control plane, so the public enterprise hostname check still passes even though the origin certificate is issued for the dedicated origin hostname.

After the Front Door update, verify with the stricter expectation:

```bash
EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL=HttpsOnly \
EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME=origin.enterprise.vaultproof.dev \
EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK=Enabled \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run verify:enterprise-production
```

If anything fails, roll back Front Door route forwarding to `HttpOnly` and the previous VM origin settings while leaving the TLS proxy installed for debugging:

```bash
ACTION=rollback npm run cutover:enterprise-origin-tls
```

### SSH Bootstrap Lockdown

The VM keeps public SSH open only for bootstrap and break-glass access. Close it after `enterprise.vaultproof.dev/readiness` is production-ready, Front Door reaches the Confidential VM origin, and you have an alternate operational path such as Azure Bastion, JIT VM access, serial console, or a controlled temporary NSG reopen process.

Preview the current SSH bootstrap rule:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ACTION=plan \
bash infra/azure/enterprise-secure-runtime/harden-ssh-bootstrap.sh
```

Close public SSH bootstrap. The script refuses to close SSH unless `/readiness` reports production-ready with no production blockers:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ENTERPRISE_URL=https://enterprise.vaultproof.dev \
ACTION=close \
bash infra/azure/enterprise-secure-runtime/harden-ssh-bootstrap.sh
```

Verify the locked-down posture without SSH-based loopback checks:

```bash
EXPECTED_SSH_BOOTSTRAP_ACCESS=Deny \
RUN_SSH_CHECKS=false \
npm run verify:enterprise-production
```

Break-glass reopen:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ACTION=reopen \
bash infra/azure/enterprise-secure-runtime/harden-ssh-bootstrap.sh
```

For declarative redeploys, set `allowSshBootstrap=false` in `main.bicep` parameters after the VM is stable. Keep it `true` during initial provisioning or when running SSH-based deployment helpers.

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
- Optionally validates bearer JWTs with APIM `validate-jwt` before forwarding to the control plane.
- Adds `x-vaultproof-apim: enterprise`.
- Adds `x-vaultproof-customer-gateway: vaultproof-managed`.
- Strips provider-secret style headers such as `x-api-key`, `openai-api-key`, `anthropic-api-key`, and `stripe-api-key`.
- Preserves `Authorization` so the VaultProof control plane can still validate Supabase/user/project auth.
- Optionally forwards a secret `x-vaultproof-origin-lock` value from an APIM named value.

When `deployMonitoring=true`, the template also wires the APIM API to the same Application Insights resource used for production availability tests. APIM diagnostics log gateway errors and W3C correlation metadata without logging request or response bodies.

The template also creates APIM operations for:

- `GET /health`
- `GET /readiness`
- `POST /execute`
- `* /api/v1/enterprise/{*path}`

To deploy APIM without changing the live Front Door route, keep Front Door pointed at the Confidential VM and deploy APIM as a sidecar gateway first:

```bash
az deployment group create \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm-apim \
  --template-file infra/azure/enterprise-secure-runtime/main.bicep \
  --parameters \
    location=eastus \
    environmentName=vpenteu \
    adminUsername=azureuser \
    adminSshPublicKey='<existing SSH public key>' \
    vmSize=Standard_DC2as_v5 \
    sshSourceCidr='<your current IPv4>/32' \
    allowSshBootstrap=true \
    executorSourceCidr=10.42.1.0/24 \
    allowFrontDoorToControlPlane=true \
    controlPlaneIngressSource=AzureFrontDoor.Backend \
    allowApiManagementToControlPlane=true \
    deployPrototypeReleaseKey=false \
    deployManagedHsm=true \
    managedHsmInitialAdminObjectId='<your Entra object id>' \
    deployApiManagement=true \
    apiManagementBackendUrl='http://20.85.214.14:3001' \
    apiManagementOriginLockSecret='<same value as ENTERPRISE_ORIGIN_LOCK_SECRET>' \
    apiManagementJwtValidationEnabled=true \
    apiManagementJwtOpenIdConfigUrl='https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration' \
    apiManagementJwtAudiences='["<expected-api-audience>"]' \
    deployMonitoring=true \
    monitoringAlertEmail='security@vaultproof.dev'
```

Validate the APIM gateway before considering a Front Door route change:

```bash
APIM_API_URL="$(az deployment group show \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm-apim \
  --query properties.outputs.apiManagementApiUrl.value \
  -o tsv)"

curl -sS "${APIM_API_URL}/health"
curl -sS "${APIM_API_URL}/readiness"
```

For the final VaultProof-managed APIM route, Front Door should point to the APIM gateway origin, and APIM should point to the Confidential VM control-plane origin. Avoid configuring APIM to forward to `https://enterprise.vaultproof.dev`, because that creates a routing loop once Front Door sends `enterprise.vaultproof.dev` to APIM.

Later policies should add Entra-aware products/subscriptions, per-customer quota tiers, and OpenAPI publishing. JWT validation, coarse request limits, request-size guards, provider-secret header stripping, APIM origin locking, and Application Insights diagnostics are already deployable from this template.

## Enterprise Execution Policy

Enterprise execution policy is stored in `projects.caller_lock_policy`. The control plane enforces it before signing a secure-execution envelope, so disallowed requests never reach the Confidential VM executor.

Supported project-level fields:

- `allowed_providers`: provider names or slugs, such as `openai` or `stripe`.
- `allowed_methods`: HTTP methods, such as `GET` or `POST`.
- `allowed_upstream_hosts`: upstream hosts or URLs, such as `api.openai.com`.
- `allowed_upstream_path_prefixes`: upstream API path prefixes, such as `/v1/responses`.
- `rate_limit_per_minute`: maximum signed execution dispatches per minute for this project or provider override.
- `provider_overrides.<provider-or-slug>`: stricter provider-specific policy using the same fields plus the caller-lock fields.

Example:

```json
{
  "allowed_providers": ["openai"],
  "allowed_methods": ["POST"],
  "allowed_upstream_hosts": ["api.openai.com"],
  "allowed_upstream_path_prefixes": ["/v1/responses"],
  "rate_limit_per_minute": 120,
  "allowed_customer_gateways": ["vaultproof-managed"],
  "provider_overrides": {
    "openai": {
      "allowed_methods": ["POST"],
      "allowed_upstream_path_prefixes": ["/v1/responses"],
      "rate_limit_per_minute": 60
    }
  }
}
```

Denied execution-policy attempts write a governance audit event without request/response bodies or provider secrets.

## Emergency Provider Revoke

Enterprise project admins can immediately revoke a provider slot. Revocation sets `project_keys.revoked_at`, writes a governance audit event, removes the provider slot from project listings, and blocks future secure execution dispatch for that slug.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer <supabase-user-jwt>" \
  -H "Content-Type: application/json" \
  https://enterprise.vaultproof.dev/api/v1/enterprise/projects/<project-id>/providers/openai/revoke \
  -d '{"reason":"customer-requested emergency revoke"}'
```

This does not decrypt or expose the provider secret. Historical audit/evidence records stay intact.

## Audit Export

Enterprise audit review data is available from the control plane as JSON or CSV. CSV export combines governance audit events and proxy execution events for the selected organization and applies the same filters as the JSON audit endpoint.

```bash
curl -sS \
  -H "Authorization: Bearer <supabase-user-jwt>" \
  "https://enterprise.vaultproof.dev/api/v1/enterprise/audit?format=csv&days=30&limit=500" \
  > vaultproof-enterprise-audit.csv
```

Useful filters:

- `source=governance` or `source=proxy`
- `project_id=<project-id>`
- `event_type=<event-type>`
- `before=<ISO timestamp>`
- `q=<search text>`

## Access Review Evidence

Organization admins can export SOC 2 access-review evidence as JSON or CSV. The export includes active organization members, project assignments, pending invitations, reviewer metadata, and control tags for `SOC2 CC6.2` and `SOC2 CC6.3`.

```bash
curl -sS \
  -H "Authorization: Bearer <supabase-user-jwt>" \
  "https://enterprise.vaultproof.dev/api/v1/enterprise/members/access-review?format=csv" \
  > vaultproof-access-review.csv
```

## Provider Policy Overrides

Project admins can edit provider-level execution overrides from the enterprise Control page. Each provider slot can narrow allowed HTTP methods, upstream hosts, path prefixes, and per-minute rate limits without changing the project-wide origin policy.

## Microsoft Entra SSO

VaultProof uses Supabase Auth SAML SSO for the near-term Microsoft Entra path. Org admins configure the company domain and choose `microsoft-entra` in the enterprise Org page, then wire the displayed Supabase SAML metadata and ACS URLs into the customer's Entra enterprise application.

The login page starts SSO with `signInWithSSO({ domain })`, records a best-effort `organization_sso_login_started` audit event, and resolves the callback into either an existing organization membership or a matching pending invitation. Matching-domain users without membership or invitation fail closed into a pending-access state instead of broad auto-join.

## Azure Monitor Placement

The template can deploy the first production monitoring bundle without changing the live route:

- Log Analytics workspace.
- Application Insights component.
- Azure Monitor action group with optional email and webhook receivers.
- Availability test for `GET /health`.
- Availability test for `GET /readiness` with content validation for `"production_ready":true`.
- Metric alert for health availability failures.
- Severity 0 metric alert when production readiness drifts away from `production_ready=true`.
- Metric alert when the Confidential VM availability metric drops below healthy.

Deploy it after `https://enterprise.vaultproof.dev/readiness` is already production-ready:

```bash
az deployment group create \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm-monitoring \
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
    deployPrototypeReleaseKey=false \
    deployManagedHsm=true \
    managedHsmInitialAdminObjectId='<your Entra object id>' \
    deployApiManagement=false \
    deployMonitoring=true \
    monitoringEnterpriseUrl='https://enterprise.vaultproof.dev' \
    monitoringAlertEmail='security@vaultproof.dev'
```

Print the monitoring outputs:

```bash
az deployment group show \
  --resource-group vaultproof-enterprise \
  --name vp-enterprise-secure-runtime-eastus-hsm-monitoring \
  --query "properties.outputs.{workspace:monitoringWorkspaceName.value,appInsights:monitoringAppInsightsName.value,actionGroup:monitoringActionGroupName.value,healthTest:monitoringHealthWebTestName.value,readinessTest:monitoringReadinessWebTestName.value,healthAlert:monitoringHealthAlertName.value,readinessAlert:monitoringReadinessAlertName.value,vmAlert:monitoringVmAvailabilityAlertName.value}" \
  -o table
```

The readiness availability test is the production-verifier drift alarm: it fails if Front Door cannot reach the control plane, if `/readiness` stops returning HTTP 200, or if the response no longer contains `"production_ready":true`.

## Lockdown Checklist

Run the production verifier after each infrastructure or runtime change:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ENTERPRISE_URL=https://enterprise.vaultproof.dev \
FRONT_DOOR_PROFILE=vaultproof-enterprise-fd \
FRONT_DOOR_ENDPOINT=vaultproof-enterprise \
FRONT_DOOR_ROUTE=default-route \
EXPECTED_MONITORING_DEPLOYED=true \
MONITORING_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-monitoring \
npm run verify:enterprise-production
```

Before any customer-facing production handoff, also verify that the installed runtime env files no longer contain setup-time or placeholder secrets:

```bash
CONTROL_PLANE_ENV_FILE=/etc/vaultproof/enterprise-control-plane.env \
EXECUTOR_ENV_FILE=/etc/vaultproof/enterprise-secure-executor.env \
npm run verify:enterprise-secrets
```

Set `REQUIRE_ROTATION_ACK=true` if you also add `ROTATED_SUPABASE_SERVICE_ROLE_AT` and `ROTATED_EXECUTOR_SIGNING_SECRET_AT` audit markers to the control-plane env after rotating those materials.

The verifier checks Front Door readiness, Confidential VM security settings, Front Door ID origin lock, NSG posture, direct-origin rejection, and loopback readiness.

Capture a timestamped production evidence bundle for audits or handoff:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ENTERPRISE_URL=https://enterprise.vaultproof.dev \
FRONT_DOOR_PROFILE=vaultproof-enterprise-fd \
FRONT_DOOR_ENDPOINT=vaultproof-enterprise \
FRONT_DOOR_ROUTE=default-route \
npm run evidence:enterprise-production
```

By default, evidence JSON files are written to `/tmp/vaultproof-production-evidence`.

Execution-level governance audit events also include a compact executor attestation summary in `metadata.attestation` and `metadata.secure_execution.attestation`. This records hashes and identifiers needed for customer verification, including the Azure attestation token hash, release-policy hash, Managed HSM key ID/version, executor build digest, Confidential VM resource ID, and MAA claim summary. Request/response bodies and provider keys are not written to audit metadata.

- Close SSH bootstrap with `harden-ssh-bootstrap.sh` after production readiness and alternate access are verified.
- Route control plane to executor over private IP.
- Restrict executor NSG source to the control-plane subnet or private endpoint.
- Confirm no demo seed endpoint or demo seed environment variables are deployed.
- Run `npm run verify:enterprise-secrets` against the installed control-plane and executor env files.
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
