# VaultProof Provider Key Ingest

VaultProof should not accept raw upstream provider keys through the web dashboard for the current GCP demo. The dashboard can create demo placeholder provider slots, but live upstream dispatch needs encrypted provider material in `project_keys.share1_encrypted` and `project_keys.share2_encrypted`.

Use the local sealing helper when we are ready to turn a project from dry-run/demo material into a real provider-backed slot.

## Command

```bash
SUPABASE_URL="https://gwzkjiomemjlhtrdrlan.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
PROJECT_ID="..." \
PROVIDER="openai" \
PROVIDER_SLOT_SLUG="openai" \
UPSTREAM_BASE_URL="https://api.openai.com" \
AUTH_HEADER_TEMPLATE="Bearer {key}" \
EXTRA_HEADERS_JSON='{}' \
VAULT_UNWRAP_KEY_BASE64="..." \
PROVIDER_API_KEY_FILE="/path/to/provider-key.txt" \
npm run seal:enterprise-provider-slot
```

Safer alternatives:

- Put the provider key in a temporary file and pass `PROVIDER_API_KEY_FILE`.
- Pipe the provider key on stdin instead of putting it in shell history.
- Use `DRY_RUN=true` first to verify the target project and provider slot settings without writing Supabase.

## Required Inputs

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROJECT_ID` or `VP_PROJECT_ID`
- `PROVIDER_API_KEY`, `PROVIDER_API_KEY_FILE`, or stdin
- `VAULT_UNWRAP_KEY_BASE64`, `VAULT_UNWRAP_KEY_HEX`, `VAULT_UNWRAP_KEY`, or `VAULT_UNWRAP_KEY_FILE`

## Provider Presets And Extra Headers

The enterprise dashboard now includes first-pass provider presets for generic bearer, generic custom-header, generic preformatted Basic, MiniMax, OpenAI, Anthropic, common AI providers, email providers, developer APIs, observability APIs, payments APIs, and SaaS APIs. The preset fills:

- Provider slug.
- Upstream base URL.
- Auth header name.
- Auth header template.
- Optional dry-run path.
- Optional non-secret extra headers, such as `anthropic-version` or `notion-version`.

Use `EXTRA_HEADERS_JSON` only for non-secret fixed headers or values that reference the protected provider key with `{key}`. Do not put a second raw secret in `EXTRA_HEADERS_JSON`; the dashboard API and local sealing helper reject secret-looking literal values.

## What It Writes

The helper Shamir-splits the provider key into two shares, encrypts each share locally with the vault unwrap root using the same AES-256-GCM/HKDF format the GCP secure executor reads, and upserts the provider slot into Supabase.

It writes:

- `project_keys.provider`
- `project_keys.slug`
- `project_keys.upstream_base_url`
- `project_keys.auth_header_name`
- `project_keys.auth_header_template`
- `project_keys.extra_headers`
- `project_keys.share1_encrypted`
- `project_keys.share2_encrypted`
- `project_keys.revoked_at = null`

If the project belongs to an organization, it also records `enterprise_provider_key_sealed` in `organization_audit_events`.

The command output shows only the project, provider slot metadata, encrypted-share lengths, and a ciphertext fingerprint. It does not print the provider key or encrypted share payloads.

## Verification

```bash
SELF_TEST=true npm run seal:enterprise-provider-slot
```

```bash
DRY_RUN=true \
PROJECT_ID="..." \
PROVIDER_API_KEY_FILE="/path/to/provider-key.txt" \
VAULT_UNWRAP_KEY_BASE64="..." \
npm run seal:enterprise-provider-slot
```

After sealing a real key, run the live execute QA against the selected project before customer testing.
