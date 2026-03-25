# VaultProof

**The only API key vault where even we can't see your keys.**

Shamir secret sharing splits your key the instant you enter it. Zero-knowledge proofs authorize every access. Your key never exists whole on any server.

[vaultproof.dev](https://vaultproof.dev) · [Docs](https://vaultproof.dev/docs) · [Dashboard](https://vaultproof.dev/app)

---

## Quick Start

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
console.log(res.data)
```

One env var. Three lines of code. No shares, proofs, or nullifiers to manage.

## How It Works

```
You paste API key → Split into 2 Shamir shares in your browser
                  → Share 1 encrypted (AES-256-GCM) → stored in vault
                  → Share 2 stays on your device

When you make an API call:
  Your device sends Share 2 + ZK proof → Vault combines shares for ~100ms
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
| `@vaultproof/sdk` | Simple SDK — one API key, three lines of code |
| `@vaultproof/shamir` | Shamir Secret Sharing over GF(256) |
| `@vaultproof/connect` | Drop-in React widget for BYOK apps |
| `@vaultproof/backend` | Fastify API server |
| `@vaultproof/worker` | Cloudflare Worker edge proxy |

## Security

- **Shamir Secret Sharing** — Key split into shares using GF(256) polynomial interpolation
- **AES-256-GCM** — Share 1 encrypted at rest with random salt + IV per encryption
- **Noir ZK Proofs** — Cryptographic proof of key ownership without revealing the key
- **HMAC-SHA256** — Signed requests between edge and backend (30s expiry)
- **Nullifier Replay Prevention** — Every proxy call requires a unique nullifier
- **JWT Auth** — All routes protected with ownership checks
- **Rate Limiting** — Per-IP at edge (60/min) + per-user at backend (100/min)

## Tests

```bash
# Run all 40 tests
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

# Run Noir circuit tests
cd packages/circuits && nargo test
```

## License

Proprietary — Rial Labs
