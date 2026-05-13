# Azure Shutdown And Restart Notes

Last updated: 2026-05-05

## Current Source Of Truth

- Local repo: `/Users/nelson/projects/zkvault`
- GitHub remote: `https://github.com/windsurftemplate/vaultproof.git`
- Latest checked local commit during shutdown planning: `2cc6f4d`
- Local source is enough to rebuild the app later.
- Azure-only secrets, certs, runtime env files, and generated build output are not all stored in git.

## Why Azure Can Be Closed

The old Azure Managed HSM `vpenteuutf4ahzja5l3ohsm` is soft-deleted with purge protection, and docs in this repo record its scheduled purge as `2026-07-30T08:06:41Z`. Managed HSM can keep billing while soft-deleted until purged. If the goal is to stop Azure charges now, closing/canceling the Azure subscription is the cleanest billing stop.

## What To Preserve Before Closing Azure

Do not commit these files or values to git. Save them in a private password manager, encrypted archive, or another secure operator vault if restart continuity matters:

- `/etc/vaultproof/enterprise-control-plane.env`
- `/etc/vaultproof/enterprise-secure-executor.env`
- `/etc/vaultproof/tls/*`
- Azure deployment outputs for resource group `vaultproof-enterprise`
- DNS/Front Door hostnames and custom-domain validation state
- Supabase project URL, anon key, service-role key, and any rotation notes
- Key Vault Premium release-key URL/version and release-policy hash if reusing the same design

If these are not preserved, restart is still possible, but expect to recreate/rotate runtime secrets and certificate material.

## Known Azure Resource Names

- Resource group: `vaultproof-enterprise`
- Key Vault Premium: `vpenteuutf4ahzja5l3okv`
- Soft-deleted Managed HSM: `vpenteuutf4ahzja5l3ohsm`
- Front Door profile: `vaultproof-enterprise-fd`
- Front Door endpoint: `vaultproof-enterprise`
- Enterprise hostname: `enterprise.vaultproof.dev`
- Internal admin hostname: deprecated for the enterprise runtime; staff/admin pages belong to the separate `vaultproof.dev` root/B2C system.

## Local Files Not Yet Tracked In Git

These were present locally as untracked files during shutdown planning. Preserve or commit them separately if they matter:

- `docs/fundraising/vaultproof-nvidia-resubmission-deck.pptx`
- `docs/fundraising/vaultproof-pitch-deck.pptx`
- `docs/fundraising/vaultproof-seed-deck.pptx`

## Restart Later

For the Google Cloud rebuild path, use `docs/enterprise/google-cloud-migration-plan.md`. For DNS cleanup and later domain cutover, use `docs/enterprise/dns-shutdown-and-gcp-cutover-plan.md`.

1. Restore or recreate Azure resources.
2. Restore runtime env files and certs, or rotate/generate fresh values.
3. From local/GitHub source, redeploy:

```bash
npm run deploy:enterprise-vm
```

4. Verify production readiness:

```bash
npm run qa:enterprise-live-app
npm run test:enterprise-control-plane-smoke
```

If using a new Azure account/subscription, expect resource names, DNS validation, Front Door IDs, Key Vault URLs, and release-policy hashes to change.
