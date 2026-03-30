# VaultProof — Open Source Core

**You don't need to trust our servers.**

Your API key is split into two shares in your browser before any network request is made. One share never leaves your device. Here's the code that does it.

[vaultproof.dev](https://vaultproof.dev) · [Docs](https://vaultproof.dev/docs) · [Dashboard](https://vaultproof.dev/app)

---

## Try it live

The [`demo/`](./demo) folder is a Next.js app that runs the full flow in your browser:

1. Paste an OpenAI API key
2. Watch it split into 2 Shamir shares client-side (using the code in this repo)
3. Store both shares encrypted in VaultProof
4. Proxy a real OpenAI call — your key reconstructed for ~100ms then zeroed

**Run it locally with your own VaultProof account:**

```bash
# 1. Clone the repo
git clone https://github.com/VaultProof/vaultproof
cd vaultproof/demo

# 2. Add your API key
cp .env.example .env.local
# Open .env.local and set NEXT_PUBLIC_VP_DEMO_KEY to your vp_live_ key
# Get one free at vaultproof.dev/app

# 3. Run
npm install
npm run dev
```

That's it. The demo works exactly like the live version at vaultproof.dev — same code, your own key.

Or deploy to Vercel: fork this repo, set `NEXT_PUBLIC_VP_DEMO_KEY` as an environment variable in your Vercel project, and deploy the `demo/` directory.

---

## What's in this repo

| Package | Description |
|---|---|
| [`packages/shamir`](./packages/shamir) | Shamir secret sharing over GF(256) — splits your key in the browser |
| [`packages/circuits`](./packages/circuits) | Noir zero-knowledge circuits — proves authorization without revealing your key |
| [`packages/sdk`](./packages/sdk) | `@vaultproof/sdk` — the client SDK |
| [`packages/cli`](./packages/cli) | `@vaultproof/cli` — the terminal client |
| [`demo/`](./demo) | One-page Next.js demo — test the full flow in your browser |

## What's not in this repo

The backend, proxy worker, and dashboard are closed source. But by design, you don't need to trust them:

- Your key is split into 2 shares **in your browser** using the Shamir code in this repo
- Share 1 is encrypted and stored in the vault
- **Share 2 never leaves your device**
- The vault can never reconstruct your key without your device sending Share 2

The backend never sees your full key. That's not a claim — it's enforced by the math in this repo.

---

## Packages

### `@vaultproof/shamir`

```bash
npm install @vaultproof/shamir
```

Shamir (2,2) secret splitting over GF(256). Splits a secret into `n` shares where any `k` shares reconstruct the original. Used to split API keys in the browser before anything is sent to the server.

**How it works:**

For each byte of your secret, a random degree `k-1` polynomial is chosen over GF(256) where the constant term is the secret byte. The shares are evaluations of this polynomial at distinct points. Reconstruction uses Lagrange interpolation at `x=0`.

```typescript
import { splitString, combineToString, serializeShare } from '@vaultproof/shamir'

// Split a key into 2 shares (both required to reconstruct)
const shares = splitString('sk-openai-abc123', 2, 2)
const s1 = serializeShare(shares[0])  // base64 — send to vault
const s2 = serializeShare(shares[1])  // base64 — also send to vault (encrypted differently)

// Reconstruct
const key = combineToString(shares)  // 'sk-openai-abc123'
```

Single share reveals nothing about the secret — mathematically guaranteed.

---

### `@vaultproof/sdk`

```bash
npm install @vaultproof/sdk
```

Store and proxy API keys. The SDK handles Shamir splitting locally — the full key never leaves the calling process.

```typescript
import { VaultProof } from '@vaultproof/sdk'

const vault = new VaultProof('vp_live_abc123...')

// Store a key — splitting happens here, in your process, before any network call
const { id } = await vault.store('sk-openai-key', 'openai', 'Production')

// Proxy a call — key reconstructed server-side for ~100ms, then zeroed
const res = await vault.proxy(id, '/v1/chat/completions', {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }]
})
```

**What `store()` does:**
1. Calls `splitString(apiKey, 2, 2)` — locally, before any network request
2. Serializes both shares to base64
3. Sends shares (not the key) to `api.vaultproof.dev` over TLS

**What `proxy()` does:**
1. Sends your `vp_live_` key + key ID to the VaultProof edge worker
2. Worker retrieves both encrypted shares from the backend
3. Decrypts and reconstructs the full key in memory
4. Makes the upstream API call
5. Zeros the key from memory
6. Returns the response

---

### `@vaultproof/cli`

```bash
npm install -g @vaultproof/cli
vaultproof --help
```

Terminal client for storing, retrieving, and injecting API keys at runtime.

```bash
# Store a key
vaultproof store sk-openai-abc123 --provider openai --label Production

# Inject into a process as an environment variable
eval $(vaultproof env -p openai)
# → OPENAI_API_KEY is now set in your shell for this session only

# List stored keys
vaultproof keys
```

Session tokens are kept in-memory only — never written to disk. Two auth modes:
- **Interactive** (TTY detected): session token required, refreshed every 4 minutes
- **CI mode** (`CI=true` or no TTY): `vp_live_` key only, no session token

---

### ZK Circuits (`packages/circuits`)

[Noir](https://noir-lang.org/) circuits used to generate zero-knowledge proofs for key authorization. A ZK proof proves you are authorized to use a key without revealing the key itself.

Built with Noir >=0.36.0.

```bash
cd packages/circuits
nargo test   # run all circuit tests
nargo prove  # generate a proof
```

---

## Run tests

```bash
# All packages
npm install
npm run test

# Individual
cd packages/shamir && node --test dist/shamir.test.js
cd packages/circuits && nargo test
```

---

## License

MIT
