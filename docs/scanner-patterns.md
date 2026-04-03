# Scanner Detection Patterns

How the VaultProof scanner detects exposed API keys and reduces false positives.

## Detection Phases

### Phase A: `.env` File Parsing
Parses `KEY=VALUE` pairs from `.env` files. Identifies the provider by matching the value against known key prefixes or by matching the variable name (e.g., `OPENAI_API_KEY`).

### Phase B: Hardcoded String Detection
Extracts quoted strings from source code and matches them against key prefix patterns. Filters applied:

- **Minimum length**: Strings under 20 characters are skipped (catches prefix-only matches like `sk-proj-`)
- **Comment lines skipped**: Lines starting with `//`, `#`, `/*`, or `*`
- **Regex/pattern lines skipped**: Lines containing `pattern`, `regex`, or `RegExp` alongside regex syntax
- **Regex metacharacters**: Strings containing `\`, `^`, `$`, `*`, `+`, `?`, `{}`, `()`, `|`, `[]` are skipped (likely patterns, not real keys)
- **Placeholder values**: Strings matching `xxx`, `example`, `placeholder`, `TODO`, `your-key-here` are skipped

### Phase C: Code-Level Detection
Detects SDK initializations (`new OpenAI(`, `new Anthropic(`), HTTP API URLs (`api.openai.com`), and environment variable references (`process.env.OPENAI_API_KEY`).

### Phase D: Git History Scan
Scans the last 10 commits for deleted lines matching key patterns. Catches keys that were committed and then removed.

## Supported Providers (33+)

| Provider | Key Prefix | Min Length |
|----------|-----------|------------|
| OpenAI | `sk-proj-*`, `sk-*` | 20+ chars after prefix |
| Anthropic | `sk-ant-*` | 20+ chars after prefix |
| Stripe | `sk_live_*`, `sk_test_*`, `pk_*`, `whsec_*`, `rk_*` | 20+ chars after prefix |
| Google | `AIza*` | 39 chars total |
| AWS | `AKIA*`, `ASIA*` | 20 chars total |
| GitHub | `ghp_*`, `ghs_*`, `github_pat_*` | 20+ chars after prefix |
| SendGrid | `SG.*.*` | Full format required |
| Resend | `re_*` | 20+ chars |
| Supabase | JWT format (`eyJhbG...`) | Full JWT required |
| Slack | `xoxb-*`, `xoxp-*` | Full format required |
| Twilio | `SK*` | 34 chars total |
| Groq | `gsk_*` | 40+ chars |
| Perplexity | `pplx-*` | 40+ chars |
| Replicate | `r8_*` | 30+ chars |
| Fireworks | `fw_*` | 30+ chars |
| Together | `tog_*` | 20+ chars |
| Datadog | `dd*_*` | 32+ chars |
| Contentful | `CFPAT-*` | 40+ chars |
| PostHog | `phc_*` | 30+ chars |
| Neon | `nk_*` | 20+ chars |
| Upstash | `AX*` | 30+ chars |
| MongoDB | `mongodb+srv://` | Connection string |
| npm | `npm_*` | 36 chars |
| Brevo | `xkeysib-*` | 40+ chars |
| FaunaDB | `fnA*` | 20+ chars |

## Key Verification

The scanner can verify if detected keys are still active for these providers:

- **OpenAI** — `GET /v1/models`
- **Anthropic** — `GET /v1/models`
- **Stripe** — `GET /v1/balance`
- **GitHub** — `GET /user`
- **SendGrid** — `GET /v3/scopes`
- **Resend** — `GET /domains`

Returns `active`, `revoked`, or `unknown` (for providers without verification).

## Files Scanned

**Extensions**: `.env`, `.ts`, `.js`, `.jsx`, `.tsx`, `.py`, `.go`, `.rb`, `.java`, `.php`, `.mjs`, `.cjs`

**Skipped directories**: `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `vendor`, `__pycache__`, `coverage`, `.output`, `.turbo`, `.git`, `test`, `tests`, `__tests__`, `__mocks__`, `fixtures`

**Skipped files**: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`, `Gemfile.lock`, `Pipfile.lock`, `poetry.lock`

**Limits**: Max 200 files, max 10,000 lines per file, max 2,000 chars per line.

## Platform Detection

Detects deployment platforms from config files:

| File | Platform |
|------|----------|
| `vercel.json`, `.vercel/project.json` | Vercel |
| `railway.toml`, `railway.json` | Railway |
| `fly.toml` | Fly.io |
| `render.yaml` | Render |
| `netlify.toml` | Netlify |
| `Dockerfile` | Docker |
| `Procfile` | Heroku |
| `.github/workflows/*.yml` | GitHub Actions |

## Reducing False Positives

If the scanner flags something incorrectly:

1. **Allowlist** — Add file paths or env names to the allowlist (per-repo or global)
2. **Ignore** — Mark individual findings as ignored
3. **Bulk ignore** — Select multiple findings and ignore them at once
