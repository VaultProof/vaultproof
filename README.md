# VaultProof

**The only API key vault where even we can't see your keys.**

Shamir secret sharing splits your key the instant you enter it. Zero-knowledge proofs authorize every access. Your key never exists whole on any server.

[vaultproof.dev](https://vaultproof.dev) · [Docs](https://vaultproof.dev/docs) · [Dashboard](https://vaultproof.dev/app)

---

## Quick Start

### Option 1: Transparent Proxy (one-line change)

Keep your existing SDK. Just change the base URL:

```javascript
const openai = new OpenAI({
  apiKey: process.env.VAULTPROOF_API_KEY,          // your vp_live_ key
  baseURL: 'https://api.vaultproof.dev/v1/openai'  // VaultProof proxy
});
// Everything else stays the same — VaultProof reconstructs the real key server-side
```

### Option 2: Environment Injection (zero code changes)

```bash
# Install the CLI
npm install -g @vaultproof/cli

# Store your API key
vaultproof store -p openai

# Run your app with keys injected
vaultproof exec -- npm start
```

Your app reads `process.env.OPENAI_API_KEY` as usual — VaultProof injects the real key at runtime.

### Option 3: SDK

```bash
npm install @vaultproof/sdk
```

```javascript
import VaultProof from '@vaultproof/sdk'

const vault = new VaultProof('vp_live_abc123...')
const key = await vault.store('sk-openai-key', 'openai', 'Production')
const res = await vault.proxy(key, '/v1/chat/completions', {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

## Scanner — Find Exposed Keys

Scan your project for exposed API keys in `.env` files, source code, and git history:

```bash
# Scan only (no changes)
vaultproof scan
vaultproof scan --verify          # check if keys are still active
vaultproof scan --git-history     # also check deleted commits

# Migrate (scan + store + rewrite)
vaultproof migrate                # interactive, asks before each change
vaultproof migrate --revert       # undo all changes
```

The scanner detects 71 key patterns across providers including OpenAI, Anthropic, Stripe, AWS, Google, Supabase, GitHub, Twilio, SendGrid, Slack, Discord, Datadog, Contentful, FaunaDB, Apollo, and more. Shannon entropy filtering reduces false positives.

The **Dashboard Scanner** at [vaultproof.dev/app/scanner](https://vaultproof.dev/app/scanner) scans your GitHub repos remotely and can create PRs to remove exposed keys (Pro plan).

## How It Works

```
You paste API key → Split into 2 Shamir shares in your browser
                  → Share 1 encrypted (AES-256-GCM) → stored in vault
                  → Share 2 encrypted with your vp_live_ key → stored in vault

When you make an API call:
  Server decrypts both shares → combines for ~100ms
  → Makes API call → Zeros key from memory → Returns response
```

**The full API key never exists on any server except for ~100ms during the proxied call.**

## Architecture

```
vaultproof.dev              Cloudflare Pages (landing + docs + dashboard)
api.vaultproof.dev          Cloudflare Worker (edge proxy, HMAC-signed)
  └→ Railway backend        Fastify + Prisma + AES-256-GCM + Noir ZK
       └→ Supabase          PostgreSQL (encrypted shares + audit logs)
```

## Packages

| Package | Description |
|---|---|
| `@vaultproof/cli` | CLI — scan, migrate, store, proxy, env injection |
| `@vaultproof/sdk` | SDK — one API key, three lines of code |
| `@vaultproof/shamir` | Shamir Secret Sharing over GF(256) |
| `@vaultproof/connect` | Drop-in React widget for BYOK apps |
| `@vaultproof/backend` | Fastify API server |
| `@vaultproof/worker` | Cloudflare Worker edge proxy |

## CLI Reference

```bash
vaultproof login              # authenticate via browser
vaultproof store -p openai    # store an API key (Shamir-split locally)
vaultproof keys               # list stored keys
vaultproof scan               # scan project for exposed keys
vaultproof scan --verify      # scan + verify keys are active
vaultproof scan --git-history # scan + check deleted commits
vaultproof migrate            # scan + store + rewrite configs
vaultproof migrate --revert   # undo migrate changes
vaultproof env -p openai      # export key as env var
vaultproof exec -- npm start  # run command with keys injected
vaultproof proxy -k <id>      # make a proxied API call
vaultproof revoke -k <id>     # revoke a key
vaultproof test               # test connection
```

## Security

- **Shamir Secret Sharing** — Key split into 2-of-2 shares using GF(256) polynomial interpolation
- **AES-256-GCM** — Both shares encrypted at rest with random salt + IV per encryption
- **Noir ZK Proofs** — Cryptographic proof of key ownership without revealing the key
- **HMAC-SHA256** — Signed requests between edge and backend (30s expiry)
- **Nullifier Replay Prevention** — Every proxy call requires a unique nullifier (verified before claim)
- **JWT + API Key Auth** — All routes protected with ownership checks
- **Rate Limiting** — Per-IP at edge (60/min) + per-user at backend (100/min) + per-key (60/min)
- **Live Key Verification** — Scanner calls provider APIs to confirm keys are active or revoked
- **Git History Scanning** — Finds keys deleted from files but still in commit history

## Tests

```bash
# Run all tests
cd packages/shamir && node --test dist/shamir.test.js     # 10 tests
cd packages/circuits && nargo test                          # 4 tests
cd packages/backend && node --test dist/tests/*.test.js     # 21 tests
cd packages/sdk && node --test dist/sdk.test.js             # 5 tests
```

## Development

```bash
# Install
npm install

# Build
npx turbo run build

# Run backend locally
cd packages/backend && npm run dev

# Build CLI
cd packages/cli && npm run build

# Run Noir circuit tests
cd packages/circuits && nargo test
```

## License

Proprietary — Rial Labs
