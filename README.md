# VaultProof

**Protect API keys in `.env` with split-key encryption and a transparent proxy.**

Shamir secret sharing splits your key the instant you enter it. Zero-knowledge proofs authorize every access. Your key never exists whole on any server.

[vaultproof.dev](https://vaultproof.dev) · [Docs](https://vaultproof.dev/docs) · [Dashboard](https://vaultproof.dev/app)

---

## Quick Start

The main workflow in this repo is `@vaultproof/init`:

```bash
npx @vaultproof/init
```

That scans your local `.env` files, splits matching API keys locally, uploads encrypted shares, and rewrites the environment to use a public `vp-proj-...` identifier plus per-provider proxy base URLs.

For a private or unsupported HTTP API, add the plaintext key to `.env` and run `npx @vaultproof/init custom`. The CLI will ask for the upstream URL and auth header, then protect that key the same way.

For runtime secrets that are not HTTP proxy keys, such as `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, or webhook signing secrets, run `npx @vaultproof/init secrets add`. VaultProof stores them as split shares, rewrites the local value to a `vaultproof://...` placeholder, and can inject them into a process with `npx @vaultproof/init run -- <command>`.

For network automation repos, run `npx @vaultproof/init netops`. It scans Ansible inventories, `group_vars`, `host_vars`, `.env`, `terraform.tfvars`, and `*.auto.tfvars`, then rewrites Ansible secrets to `lookup('env', ...)` and Terraform secrets to `TF_VAR_...` injection.

If you prefer a global install:

```bash
npm install -g @vaultproof/init
vaultproof-init
```

## Example

Before:

```bash
OPENAI_API_KEY=sk-proj-abc123...
STRIPE_SECRET_KEY=sk_live_123...
```

After:

```bash
VAULTPROOF_PROJECT_ID=vp-proj-abc123
OPENAI_BASE_URL=https://init.vaultproof.dev/p/openai/v1
STRIPE_BASE_URL=https://init.vaultproof.dev/p/stripe/v1
OPENAI_API_KEY=vp-proj-abc123
STRIPE_SECRET_KEY=vp-proj-abc123
```

Your existing SDKs keep reading their normal env vars; requests route through the VaultProof proxy.

## How It Works

```text
You paste API key → Split into 2 Shamir shares locally
                  → Share 1 encrypted at rest
                  → Share 2 stored separately

When your app makes a proxied API call:
  Worker fetches both shares → reconstructs key briefly in memory
  → Calls provider → zeroes key buffer
```

## Transparent Proxy

For direct proxy use, keep your existing SDK and point it at VaultProof:

```javascript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,                  // vp-proj-...
  baseURL: process.env.OPENAI_BASE_URL                 // https://init.vaultproof.dev/p/openai/v1
});
```

## Scanner — Find Exposed Keys

The init flow scans `.env`, `.env.local`, `.env.production`, and `.env.development` against the 200-provider catalog before rewriting matched keys.

```bash
# Scan only (no upload or rewrite)
npx @vaultproof/init --dry-run

# Protect a custom/internal API key from .env
npx @vaultproof/init custom

# Protect vault-only runtime secrets from .env
npx @vaultproof/init secrets add

# Run a command with vault-only secrets injected
npx @vaultproof/init run -- npm run dev

# Protect Ansible/Terraform network automation secrets
npx @vaultproof/init netops
npx @vaultproof/init netops run -- ansible-playbook site.yml

# Skip confirmation
npx @vaultproof/init --yes

# Audit and migrate keys from the legacy vp_live_ system
npx @vaultproof/init --check-legacy

# Health check for worker/auth/proxy connectivity
npx @vaultproof/init doctor
```

## Architecture

```text
vaultproof.dev              Cloudflare Pages (landing + docs + dashboard)
init.vaultproof.dev         Cloudflare Worker (init + proxy routes)
  └→ Supabase               PostgreSQL (projects + encrypted shares)
```

## Packages

| Package | Description |
|---|---|
| `@vaultproof/init` | One-command init flow for scanning, splitting, uploading, and rewriting `.env` files |
| `@vaultproof/init-worker` | Cloudflare Worker for project management and provider proxying |
| `@vaultproof/shamir` | Shamir Secret Sharing over GF(256) |
| `dashboard` | Next.js dashboard app |

## Init CLI Reference

```bash
npx @vaultproof/init
npx @vaultproof/init --yes
npx @vaultproof/init --dry-run
npx @vaultproof/init custom
npx @vaultproof/init secrets add
npx @vaultproof/init secrets pull
npx @vaultproof/init run -- npm run dev
npx @vaultproof/init netops
npx @vaultproof/init netops run -- ansible-playbook site.yml
npx @vaultproof/init --check-legacy
npx @vaultproof/init doctor
```

## Security

- **Shamir Secret Sharing** — Key split into 2-of-2 shares using GF(256) polynomial interpolation
- **AES-256-GCM / HKDF** — Share 1 encrypted at rest with server-side key derivation
- **Origin Locking** — Projects can restrict proxied requests to allowlisted origins
- **SSRF Hardening** — User-declared upstreams are validated before proxy use
- **Rate Limiting** — Per-project, per-user, and per-IP controls enforced in the worker

## Tests

```bash
npm test
npm run lint
```

## Development

```bash
npm install

npm run build
cd packages/init-cli && npm run build
cd packages/init-worker && npm run dev
cd apps/dashboard && npm run dev
```

## License

See package-level metadata and license files.
