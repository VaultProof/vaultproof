# DNS Shutdown And GCP Cutover Plan

Last updated: 2026-05-08

## Goal

Clean up `vaultproof.dev` DNS before closing Azure, keep email and the current public app working, and leave clear placeholders for the Google Cloud cutover.

## Immediate Azure Shutdown Cleanup

These records point at Azure Front Door. Remove them when Azure is stopped or closed, unless you are actively keeping the Azure enterprise runtime online:

| Type | Name | Current target | Action |
| --- | --- | --- | --- |
| CNAME | `admin` | `vaultproof-enterprise-h0bwaahfg6che7ft.z02.azurefd.net` | Delete for Azure shutdown. Recreate later for GCP admin load balancer. |
| CNAME | `enterprise` | `vaultproof-enterprise-h0bwaahfg6che7ft.z02.azurefd.net` | Delete for Azure shutdown. Recreate later for GCP enterprise load balancer. |
| TXT | `_dnsauth.admin` | Azure custom-domain validation token | Delete after Azure Front Door custom domain is no longer needed. |
| TXT | `_dnsauth.enterprise` | Azure custom-domain validation token | Delete after Azure Front Door custom domain is no longer needed. |

Do not leave `admin.vaultproof.dev` or `enterprise.vaultproof.dev` pointing to a closed Azure Front Door endpoint. That creates a confusing broken production surface and can also make later GCP validation harder to reason about.

## Keep

Keep these records unless the underlying service is intentionally being retired:

| Type | Name | Target/value | Reason |
| --- | --- | --- | --- |
| CNAME | `vaultproof.dev` | `vaultproof.pages.dev` | Main Cloudflare Pages site. |
| CNAME | `mcp` | `vaultproof.workers.dev` | MCP worker route. |
| Worker | `api.vaultproof.dev` | `zkvault` | Current API worker route. |
| Worker | `init.vaultproof.dev` | `vaultproof-init` | Current init worker route. |
| Worker | `staging-api.vaultproof.dev` | `vaultproof-staging` | Staging API worker route, if still used. |
| MX | `vaultproof.dev` | `mx.zoho.com`, `mx2.zoho.com`, `mx3.zoho.com` | Main Zoho email delivery. |
| TXT | `vaultproof.dev` | `v=spf1 include:zohomail.com ~all` | Main Zoho SPF. |
| TXT | `vaultproof.dev` | `zoho-verification=...` | Zoho domain verification. |
| TXT | `nelson._domainkey` | Zoho DKIM key | Zoho DKIM signing. |
| TXT | `_dmarc` | DMARC reporting policy | Mail reporting. Keep while cleaning email gradually. |
| TXT | `vaultproof.dev` | Google site verification values | Google/Search Console verification. |
| TXT | `google.com` | `70924217` | Keep only if you recognize the verification/use case. Otherwise verify before deleting. |

## Review Before Keeping

These look like bounce/sending records. Keep only if the related sending path is still used:

| Type | Name | Target/value | Decision |
| --- | --- | --- | --- |
| MX | `cf-bounce` | `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` | Keep if Cloudflare Email Routing/bounce handling is active. Delete if unused. |
| TXT | `cf-bounce` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Keep with the `cf-bounce` MX records if active. |
| TXT | `cf-bounce._domainkey` | Cloudflare DKIM key | Keep with Cloudflare bounce routing if active. |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | Keep if Amazon SES mail receiving/bounce handling is active. |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | Keep if SES sending from `send.vaultproof.dev` is active. |
| TXT | `resend._domainkey` | Resend DKIM key | Keep if Resend is still used. |
| TXT | `_railway-verify.hindsight` | Railway verification token | Keep only if the `hindsight` Railway app/domain still matters. |

## GCP Cutover Later

The GCP load balancer edge now exists:

- Global HTTPS IP: `34.102.179.105`
- Backend health: healthy on `10.60.0.2:3001`
- Managed certificate: provisioning until DNS points at the GCP edge
- Origin lock: not enabled yet; add the backend custom header and matching control-plane secret before customer traffic

Create these Cloudflare DNS records when ready to validate the Google-managed certificates:

| Type | Name | Value | Proxy status |
| --- | --- | --- | --- |
| A | `enterprise` | `34.102.179.105` | DNS-only for first validation |
| A | `admin` | `34.102.179.105` | DNS-only for first validation |

After DNS and TLS are healthy:

1. Keep Cloudflare DNS-only until TLS and health checks are confirmed.
2. If Cloudflare proxying is desired, enable it only after the GCP certificates, host headers, and security headers pass QA.
3. Run public checks after cutover:

```bash
curl -I https://enterprise.vaultproof.dev/
curl -I https://admin.vaultproof.dev/
RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true STRICT_LIVE=true npm run gate:gcp-customer-launch
```

## Recommended Today

1. Delete Azure records:
   - `CNAME admin`
   - `CNAME enterprise`
   - `TXT _dnsauth.admin`
   - `TXT _dnsauth.enterprise`
2. Keep main website, Worker routes, Zoho email, SPF/DKIM/DMARC, and known Google verification records.
3. Leave ambiguous sender/bounce records in place until you confirm whether Cloudflare Email Routing, SES, Resend, or Railway are still used.
4. Recreate `enterprise` as an A record to `34.102.179.105` only when you are ready to activate the GCP certificate.
5. Recreate `admin` only after the internal admin GCP path is explicitly built and verified.
