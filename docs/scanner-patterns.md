# Scanner Detection Patterns

How the VaultProof scanner detects exposed API keys and reduces false positives.

## Detection Phases

The scanner runs multiple detection phases to find exposed secrets:

1. **`.env` File Parsing** — Identifies provider keys by matching values against known patterns and variable names
2. **Hardcoded String Detection** — Extracts quoted strings from source code and matches against key patterns, with filters to reduce false positives
3. **Code-Level Detection** — Detects SDK initializations, API URLs, and environment variable references
4. **Git History Scan** — Scans recent commits for deleted lines matching key patterns (catches keys that were committed and then removed)

## Supported Providers (33+)

The scanner detects API keys for 33+ providers, including all major AI, cloud, payment, and SaaS platforms.

## Key Verification

The scanner can verify if detected keys are still active for select providers, returning `active`, `revoked`, or `unknown`.

## Files Scanned

The scanner processes common source code file types (`.ts`, `.js`, `.py`, `.go`, `.rb`, `.java`, `.php`, etc.) and `.env` files. Build artifacts, dependency directories, and lock files are skipped automatically.

**Limits**: Max 200 files, max 10,000 lines per file, max 2,000 chars per line.

## Platform Detection

The scanner detects deployment platforms (Vercel, Railway, Fly.io, Render, Netlify, Docker, Kubernetes, Heroku, GitHub Actions, GitLab CI, CircleCI) from config files to provide platform-specific remediation guidance.

## Reducing False Positives

If the scanner flags something incorrectly:

1. **Allowlist** — Add file paths or env names to the allowlist (per-repo or global)
2. **Ignore** — Mark individual findings as ignored
3. **Bulk ignore** — Select multiple findings and ignore them at once
