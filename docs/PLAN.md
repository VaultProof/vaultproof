# ZK-Secured API Key Vault & Proxy — Product Plan

## Context

No product exists that combines zero-knowledge proofs with API key management. Every secrets tool today (HashiCorp Vault, 1Password, AWS Secrets Manager) sees keys in plaintext at runtime. Meanwhile, 39M secrets leaked on GitHub in 2024, AI credential leaks surged 81% YoY, and 64% of leaked secrets are never revoked. The BYOK (bring your own key) pattern is becoming default in AI tools (JetBrains, VS Code, OpenRouter, Vercel) but the setup/security experience is terrible.

**The product:** A ZK-secured API key vault using Shamir secret sharing (key never exists whole at rest) + Noir ZK proofs for authorization + ephemeral reconstruction for proxied API calls. Ship as embeddable widget for app developers (distribution) + standalone vault dashboard for users (retention).

**Go-to-market:** API keys for indie devs/AI builders → DevOps secrets → Enterprise tier with TEE.

---

## What We're Building (MVP)

### 1. Embeddable Widget — `<ZKKeyConnect />`
- Drop-in React component app developers embed in their BYOK apps
- User pastes API key → key is split via Shamir SSS on client → Share 1 sent to vault, Share 2 stays on device
- App receives an access token (not the key) backed by ZK proof
- App makes API calls through our proxy using the access token

### 2. Vault Backend — Proxy + Key Storage
- Fastify server (reuse authenticity-platform patterns)
- PostgreSQL + Prisma for encrypted share storage + audit logs
- Noir circuit verification via Barretenberg
- Proxy layer: reconstructs key ephemerally, makes API call, zeros memory
- Rate limiting, usage tracking, billing

### 3. Vault Dashboard — User-Facing Web App
- Next.js app where users manage their stored keys
- See which apps have access, revoke access, view usage logs
- Key health monitoring (expiry, rotation reminders)
- Comes free when user stores a key through any widget

### 4. Noir ZK Circuits
- **Authorization circuit:** Prove ownership of a key slot + app is authorized + call is within permissions, without revealing key material
- Reuse Poseidon hashing + Merkle membership patterns from authenticity-platform

---

## How This Stops GitHub Secret Leaks

**Today's problem:** Developer puts `OPENAI_KEY=sk-abc123xyz789` in code → commits → pushes → key is leaked. Full key. Game over. 39M secrets leaked on GitHub in 2024 alone.

**With ZK Vault:** The developer never has the full key in their codebase. They integrate via our SDK:

```
# What's in the developer's .env / code:
ZKVAULT_ACCESS_TOKEN=zt_blind_token_no_key_material

# What's NOT in the developer's environment:
# The actual API key. It doesn't exist here. Ever.
```

If the access token leaks on GitHub, an attacker **cannot:**
- Reconstruct the API key (needs both Shamir shares — Share 2 is on the user's device)
- Generate a valid ZK proof (needs the user's private inputs, can't be forged)
- Make proxied API calls (proxy rejects without valid proof + matching share)

**A leaked access token is cryptographic garbage without both shares + a valid ZK proof.**

| Real Breach | What leaked | With ZK Vault |
|---|---|---|
| Toyota (key on GitHub 5 years) | Full API key → 296K records | Access token → zero access |
| Uber (hardcoded in repo) | Full credentials → 57M records | Access token → zero access |
| xAI (SpaceX/Tesla LLM key) | Full API key → 2 months exposed | Access token → zero access |
| Twitch (6,600 secrets in source) | 194 AWS keys, 69 Twilio keys | 6,600 blind tokens → zero access |
| CircleCI (all customer secrets) | Every key compromised | Vault shares alone → useless |

---

## Lost Device? Just Get a New Key

No recovery codes, no backup shares, no complexity. If you lose the device holding Share 2:

1. Log into the vault dashboard from any device
2. Revoke the old key slot (destroys Share 1 in vault — nobody can use it)
3. Generate a new API key from the provider (OpenAI, Google, etc.)
4. Store it through the widget again — new split, new shares

This is what people already do when they lose access to anything. The old shares are cryptographic garbage. Simple.

---

## Team Key Management (Multi-Developer)

**Today's problem:** 5 devs share an API key via .env, Slack, or 1Password. Dev leaves → key should be rotated at the provider. 64% of teams never do it.

**With ZK Vault — 2-of-n Shamir threshold:**

```
Admin enters API key
  → Shamir splits into n+1 shares (2-of-n threshold)
  → Share 0: vault stores this
  → Share 1: Dev A's device
  → Share 2: Dev B's device
  → Share 3: Dev C's device

Any one dev's share + vault's share = reconstruct the key
```

**When a dev makes an API call:**
- Dev B's app sends Share 2 + ZK proof ("I'm an authorized team member")
- Vault verifies proof, combines Share 0 + Share 2, makes API call, zeros memory

**When a dev leaves:**
- Admin clicks "Revoke Dev B" in dashboard
- Dev B's share is invalidated, key re-split for remaining devs
- Dev B's old share becomes cryptographic garbage
- **No need to rotate the actual API key at the provider** — just revoke the share

**ZK privacy bonus:** Audit log proves *someone authorized* made each call, without revealing *which* team member (unless admin opts into identity-linked logging). Individual usage is private by default.

---

## Architecture

```
┌──────────────────┐                         ┌──────────────────────┐
│  App Developer's  │  Access token +         │  ZK Vault Backend     │
│  App (embeds      │  ZK proof              │                       │
│  <ZKKeyConnect/>) │ ──────────────────────→ │  1. Verify ZK proof   │
│                   │                         │  2. Retrieve Share 1  │
│  User's device    │  Share 2 (encrypted)    │  3. Combine shares    │
│  holds Share 2    │ ──────────────────────→ │  4. Make API call     │
│                   │                         │  5. Zero memory       │
│                   │  ←───────────────────── │  6. Return response   │
│                   │  API response           │  7. Log (ZK audit)    │
└──────────────────┘                         └──────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │  OpenAI / Google  │
                                              │  Adzuna / etc.    │
                                              └──────────────────┘
```

---

## Tech Stack

| Layer | Tech | Rationale |
|---|---|---|
| Widget | React + TypeScript + Noir WASM | Proof generation in browser, no key leaves device unsplit |
| Dashboard | Next.js 15 + Tailwind + shadcn/ui | Consistent with your other projects |
| Backend | Fastify + TypeScript + Prisma | Reuse from authenticity-platform |
| Database | PostgreSQL | Reuse from authenticity-platform |
| ZK Circuits | Noir (Plonk) + Barretenberg | Your experience, browser WASM support |
| Secret Sharing | Shamir SSS (TypeScript impl) | 2-of-n threshold (solo: 2-of-2, teams: 2-of-n) |
| Proxy | Cloudflare Workers | Edge deployment, 330+ cities, sub-ms cold starts, stream-through SSE |
| Edge Cache | Cloudflare KV | Cache Share 1 at edge to eliminate DB round-trip on hot path |
| Auth | Supabase Auth or custom JWT | User accounts for vault dashboard |
| Deployment | Vercel (dashboard) + Cloudflare Workers (proxy) | Edge proxy = ~30-50ms overhead, 99.99% uptime |

---

## Reusable Code from Existing Projects

| Component | Source | File |
|---|---|---|
| Noir proof verification | authenticity-platform | `packages/backend/src/services/proof-verifier.ts` |
| KMS key management abstraction | authenticity-platform | `packages/backend/src/crypto/kms.ts` |
| Merkle tree (Poseidon) | authenticity-platform | `packages/backend/src/crypto/merkle.ts` |
| Fastify server setup + security | authenticity-platform | `packages/backend/src/server.ts` |
| Prisma schema patterns | authenticity-platform | `packages/backend/prisma/schema.prisma` |
| Challenge-response auth | authenticity-platform | `packages/backend/src/nfc/tag-auth.ts` |
| Proof chain composition | rial | `backend/zk/proof-chain.js` |

**New code needed:**
- Shamir Secret Sharing (TypeScript, client + server)
- Noir authorization circuit (new circuit)
- Embeddable React widget
- API proxy with ephemeral reconstruction
- Vault dashboard (Next.js)

---

## Noir Circuit Design

### Authorization Circuit (`key_auth.nr`)

**Private inputs:**
- `key_share_hash` — hash of user's Share 2
- `slot_secret` — secret proving key slot ownership
- `app_auth_path` — Merkle path proving app is in authorized set

**Public inputs:**
- `vault_commitment` — commitment to the key slot (stored on-chain or in DB)
- `app_id_hash` — hash of the requesting app's ID
- `authorized_apps_root` — Merkle root of authorized apps for this key
- `nullifier` — prevents proof replay

**Proves:**
1. User owns the key slot (knows slot_secret that hashes to vault_commitment)
2. Requesting app is authorized (Merkle membership in authorized_apps_root)
3. Proof is fresh (nullifier is unique per request)

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
1. Scaffold monorepo (Turborepo: `packages/circuits`, `packages/backend`, `packages/widget`, `apps/dashboard`)
2. Implement Shamir Secret Sharing (2-of-2) in TypeScript
3. Write Noir authorization circuit + tests
4. Set up Fastify backend with Prisma schema (keys, shares, apps, audit_logs)
5. Build ephemeral reconstruction + proxy logic

### Phase 2: Widget (Week 3)
6. Build `<ZKKeyConnect />` React component
7. Integrate Noir WASM proof generation in browser
8. Client-side Shamir splitting on key entry
9. Share 2 encrypted storage on device (localStorage + encryption)
10. Publish to npm as `@zkvault/connect`

### Phase 3: Dashboard (Week 4)
11. Next.js vault dashboard with Supabase Auth
12. Key management UI (view keys, revoke app access, usage logs)
13. Key health monitoring (API key validation, rotation reminders)

### Phase 4: Polish & Launch (Week 5)
14. Documentation site (how to embed widget, API reference)
15. Landing page with security architecture explainer
16. Beta launch — target BYOK AI tool developers

---

## Database Schema (Prisma)

```prisma
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  created_at    DateTime  @default(now())
  key_slots     KeySlot[]
}

model KeySlot {
  id                String       @id @default(uuid())
  user_id           String
  user              User         @relation(fields: [user_id], references: [id])
  provider          String       // "openai", "anthropic", "google", etc.
  label             String       // user-friendly name
  share1_encrypted  Bytes        // Server's share, encrypted with KMS
  vault_commitment  String       // Public commitment for ZK verification
  auth_apps_root    String       // Merkle root of authorized apps
  status            KeyStatus    @default(ACTIVE)
  created_at        DateTime     @default(now())
  rotated_at        DateTime?
  access_logs       AccessLog[]
  app_grants        AppGrant[]
}

model AppGrant {
  id          String   @id @default(uuid())
  key_slot_id String
  key_slot    KeySlot  @relation(fields: [key_slot_id], references: [id])
  app_id      String
  app_name    String
  permissions Json     // { endpoints: [...], rate_limit: 100 }
  granted_at  DateTime @default(now())
  revoked_at  DateTime?
}

model AccessLog {
  id          String   @id @default(uuid())
  key_slot_id String
  key_slot    KeySlot  @relation(fields: [key_slot_id], references: [id])
  app_id      String
  action      String   // "api_call", "key_rotation", "grant", "revoke"
  zk_proof    String   // Serialized proof for audit
  nullifier   String   @unique // Prevents replay
  timestamp   DateTime @default(now())
  metadata    Json?    // { endpoint, status_code, latency_ms }
}

enum KeyStatus {
  ACTIVE
  ROTATED
  REVOKED
}
```

---

## Monetization

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 3 key slots, 1,000 proxied calls/mo, 1 app grant per key |
| **Pro** | $12/mo | 20 key slots, 50K calls/mo, unlimited app grants, usage analytics |
| **Team** | $39/mo | 100 key slots, 200K calls/mo, team sharing, SSO, audit export |
| **Enterprise** | Custom | Unlimited, TEE option, SLA, dedicated proxy, SOC 2 report |

Additional: 0.1¢ per proxied call over tier limit (usage-based overage).

---

## Infrastructure Costs

### Early Stage (0 – 1,000 users) — Nearly Free

| Service | Free Tier | When you outgrow free |
|---|---|---|
| Cloudflare Workers (proxy) | 100K req/day free | $5/mo for 10M req/mo |
| Cloudflare KV (edge cache) | 100K reads/day free | $5/mo for 10M reads |
| Supabase (PostgreSQL + auth) | 500MB, 50K rows free | $25/mo Pro |
| Vercel (dashboard + landing) | Free tier | $20/mo Pro |
| Domain | — | ~$12/yr |
| **Total** | **~$0/mo** | **~$56/mo** |

### Per-User Unit Economics

For a user making 1,000 proxied API calls/month:
- Cloudflare Workers: ~$0.30 (1K req × $0.30/million)
- Database ops: ~$0.02
- ZK proof verification: ~$0.00 (proof generated client-side in browser WASM)
- **Total cost per user: ~$0.32/mo**
- **Pro tier revenue: $12/mo → 97% margin**

### At Scale (10,000 users, 10% Pro conversion)

| | Monthly |
|---|---|
| Infrastructure cost | ~$100 |
| Revenue (1,000 Pro × $12) | $12,000 |
| **Margin** | **~99%** |

### Cost vs Competitors

| Product | Cost per secret/month |
|---|---|
| HashiCorp Vault Cloud | $21.60 ($0.03/secret/hour) |
| AWS Secrets Manager | $0.40 + API call fees |
| 1Password Business | $7.99/user (flat) |
| **This product** | **~$0.32/user** regardless of secret count |

---

## Latency & Uptime Strategy

### Proxy Latency: ~30-50ms overhead

OpenRouter (closest comparable proxy) achieves 50-70ms overhead using Cloudflare Workers. Our proxy is simpler (no routing logic, no billing, no multi-provider fallback) — just: verify ZK proof → reconstruct key → forward → stream back.

**How we minimize latency:**
- **Cloudflare Workers at the edge** — 330+ cities, V8 isolates, sub-ms cold starts
- **Edge caching via KV** — Share 1 cached at edge, no DB round-trip on hot path
- **Stream-through SSE** — chunks forwarded as they arrive, no buffering
- **No batching** — each request independently processed

For context: on a 2-10 second LLM response, 30-50ms is imperceptible.

### Uptime: 99.99% via Cloudflare

- Cloudflare Workers run on 330+ locations across 122+ countries
- Anycast routing = automatic failover to nearest healthy node
- No single server dependency — multi-cloud by default
- If one region goes down, traffic routes to the next closest automatically

---

## Investor Pitch — Key Numbers

### The Problem
- **39M secrets leaked** on GitHub in 2024 (GitHub disclosure)
- **81% surge** in AI service credential leaks YoY (GitGuardian 2026)
- **64% of leaked secrets** never get revoked
- **$4.88M** average cost of a credential breach (IBM)
- **$234K-$387K/year** hidden cost of credential management for a 50-dev org
- **65% of Forbes AI 50** companies had leaked verified secrets on GitHub (Wiz, Nov 2025)

### Real Breaches This Product Prevents
| Company | What Happened | Impact |
|---|---|---|
| Toyota | API key on GitHub for 5 years | 296K customer records |
| Uber | Hard-coded GitHub credentials | 57M records |
| Twitch | 6,600 secrets in leaked source | 194 AWS keys, 69 Twilio keys |
| Codecov | Supply chain attack extracting keys | 23K+ customers for 2+ months |
| CircleCI | All customer secrets compromised | Every customer rotated everything |
| xAI | Dev leaked SpaceX/Tesla LLM key | 2 months of exposure |

**In every case, Shamir splitting would have made the stolen data useless — half a key is cryptographic garbage.**

### Market Size
- **TAM:** $14.6B (API mgmt + secrets mgmt + ZK markets combined, 2025)
- **SAM:** $2-3B (developer-focused API key management within BYOK/AI ecosystem)
- **SOM:** $200-500M (AI-first companies, BYOK tool ecosystem, >50-dev enterprises)

### Why Now
1. AI is creating millions of new API key holders who aren't developers (BYOK is default in JetBrains, VS Code, Vercel, OpenRouter)
2. Machine identities outnumber humans 45:1 and growing 44% YoY
3. SEC requires breach disclosure within 4 business days; GDPR fines total EUR 5.88B
4. Zero-trust adopted by 96% of orgs, but no secrets tool delivers true zero-knowledge
5. ZK proof market: $1.28B → $7.59B by 2033 (22.1% CAGR)

### Competitive Moat — Why This Is Hard to Copy

**Layer 1: Cryptographic moat (deep tech)**

| Competitor | Can they see your key? | ZK proofs? | Key splitting? |
|---|---|---|---|
| HashiCorp Vault (IBM, $6.4B) | Yes, at runtime | No | No |
| 1Password ($400M ARR) | Yes, at runtime | No | No |
| AWS Secrets Manager | Yes, at runtime | No | No |
| Infisical ($16M Series A) | Yes, at runtime | No | No |
| Doppler ($28.9M raised) | Yes, at runtime | No | No |
| OpenRouter (BYOK proxy) | Yes, stores full key | No | No |
| **This product** | **Never — split + ephemeral** | **Yes (Noir)** | **Yes (Shamir 2-of-n)** |

Every competitor would need to fundamentally re-architect to match this. They can't bolt ZK + Shamir onto existing systems — it requires redesigning the core data model. HashiCorp has 10+ years of architecture debt that assumes plaintext access at runtime.

**Layer 2: Widget distribution moat (network effects)**

Every app that embeds `<ZKKeyConnect />` sends users to your vault. Each new user makes the widget more attractive to the next app developer (more users already have accounts). This is the same flywheel that made "Sign in with Google" dominant — once users have a vault, they prefer apps that use it over re-entering keys.

```
More apps embed widget → more users create vaults → more apps want to embed → flywheel
```

**Layer 3: Switching cost moat**

Once a user stores 10-20 API keys in the vault with app permissions configured, they're not switching. Migrating secrets is painful and risky. Same reason people stay with 1Password — the vault itself is sticky.

**Layer 4: Trust/audit moat**

ZK proofs are verifiable. Open-source the circuits. Publish third-party audits. Once you're the "mathematically proven zero-knowledge" option, competitors saying "trust us, we don't log your keys" sounds weak by comparison. Trust compounds over time.

**Layer 5: Data moat (future)**

Aggregate anonymized usage patterns across all proxied calls: which APIs are most used, error rates by provider, latency trends. Sell this intelligence back to API providers and enterprises. No individual keys exposed — just trends. Only possible at scale.

**Why incumbents won't build this:**
- **HashiCorp/IBM:** Just spent $6.4B on the acquisition. They're integrating, not innovating. Enterprise DNA — won't build a developer widget.
- **1Password:** Password manager expanding to developer secrets. ZK is not their competency and their architecture doesn't support it.
- **AWS/Google:** They're the API providers. Building a vault that hides keys from themselves is a conflict of interest.
- **Infisical/Doppler:** Closest threat. Could theoretically add ZK. But they'd need to rewrite their core and they're focused on growing current product, not pivoting architecture.
- **OpenRouter:** API proxy, not security company. Their moat is routing intelligence, not key protection.

### The Pitch (One Line)
*"The only API key infrastructure where even we can't see your keys. Shamir splitting + zero-knowledge proofs = breaches are architecturally impossible, not just policy-prohibited."*

---

## Verification / Testing Plan

1. **Noir circuit tests:** `nargo test` on authorization circuit — prove valid auth, reject invalid, reject replayed nullifiers
2. **Shamir SSS tests:** Split key → reconstruct → verify match; verify single share reveals nothing
3. **Proxy integration test:** Store key via widget → make proxied API call → verify response matches direct API call
4. **Security test:** Attempt to reconstruct key with only Share 1 (must fail); dump server memory during call (key should not persist)
5. **Widget test:** Embed in test React app → paste OpenAI key → verify split + proof generation → make proxied chat completion
6. **Load test:** 100 concurrent proxied calls — verify latency overhead < 50ms per call
7. **Audit log test:** Every proxied call produces verifiable ZK proof in access_logs

---

## Sources

- [GitGuardian 2026 Secrets Sprawl Report](https://www.gitguardian.com/state-of-secrets-sprawl-report-2026)
- [GitHub Secret Scanning Blog](https://github.blog/security/application-security/next-evolution-github-advanced-security/)
- [Postman 2025 State of the API](https://www.postman.com/state-of-api/2025/)
- [IBM/HashiCorp $6.4B Acquisition](https://techcrunch.com/2025/02/27/ibm-closes-6-4b-hashicorp-acquisition/)
- [Infisical $16M Series A](https://finance.yahoo.com/news/infisical-secures-16m-series-redefine-133000838.html)
- [1Password $400M ARR](https://1password.com/press/2025/nov/1password-strengthens-leadership-amid-growth-milestone)
- [Wiz — 65% of AI 50 Leaked Secrets](https://www.theregister.com/2025/11/10/ai_companies_private_api_keys_github/)
- [Krebs on Security — xAI Leak](https://krebsonsecurity.com/2025/05/xai-dev-leaks-api-key-for-private-spacex-tesla-llms/)
- [Grand View Research — ZK Proof Market](https://www.grandviewresearch.com/industry-analysis/zero-knowledge-proof-market-report)
- [Mordor Intelligence — API Management Market](https://www.mordorintelligence.com/industry-reports/api-management-market)
- [Mordor Intelligence — Secrets Management Market](https://www.mordorintelligence.com/industry-reports/secrets-management-solutions-market)
- [SEC Cybersecurity Disclosure Rules](https://www.sec.gov/newsroom/press-releases/2023-139)
- [Toyota Breach — GitGuardian](https://blog.gitguardian.com/toyota-accidently-exposed-a-secret-key-publicly-on-github-for-five-years/)
