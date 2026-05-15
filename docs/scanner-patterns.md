# Scanner Detection Patterns

How the VaultProof scanner detects exposed API keys and reduces false positives.

## Detection Phases

The scanner runs multiple detection phases to find exposed secrets:

1. **`.env` File Parsing** — Identifies provider keys by matching values against known patterns and variable names
2. **Hardcoded String Detection** — Extracts quoted strings from source code and matches against key patterns, with filters to reduce false positives
3. **Code-Level Detection** — Detects SDK initializations, API URLs, and environment variable references
4. **Git History Scan** — Scans recent commits for deleted lines matching key patterns (catches keys that were committed and then removed)

## Supported Providers (87)

The scanner detects API keys for 87 providers, including major AI, cloud, payment, DevOps, observability, email, database, and SaaS platforms.

For unsupported or internal HTTP APIs, `npx @vaultproof/init custom` can select a key from `.env` and ask for the upstream URL and auth header instead of relying on a catalog signature.

For non-proxy runtime secrets, `npx @vaultproof/init secrets add` detects common names such as `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, and `WEBHOOK_SECRET`, then rewrites them to `vaultproof://` placeholders for `npx @vaultproof/init run -- <command>`.

For network automation repos, `npx @vaultproof/init netops` scans Ansible inventories, `group_vars`, `host_vars`, `.env`, `terraform.tfvars`, and `*.auto.tfvars`. It rewrites Ansible secrets to `lookup('env', ...)`, comments Terraform secret assignments so `TF_VAR_...` can be injected, and runs automation with `npx @vaultproof/init netops run -- <command>`.

## Key Verification

The scanner can verify if detected keys are still active for select providers, returning `active`, `revoked`, or `unknown`.

## Files Scanned

The scanner processes common source code file types (`.ts`, `.js`, `.py`, `.go`, `.rb`, `.java`, `.php`, etc.) and `.env` files. Build artifacts, dependency directories, and lock files are skipped automatically.

**Limits**: Max 200 files, max 10,000 lines per file, max 2,000 chars per line.

## Platform Detection

The scanner detects deployment platforms (Vercel, Railway, Fly.io, Render, Netlify, Docker, Heroku, GitHub Actions) from config files to provide platform-specific remediation guidance.

## Reducing False Positives

If the scanner flags something incorrectly:

1. **Allowlist** — Add file paths or env names to the allowlist (per-repo or global)
2. **Ignore** — Mark individual findings as ignored
3. **Bulk ignore** — Select multiple findings and ignore them at once
