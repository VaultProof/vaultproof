# VaultProof — Technical Specification
## For Claude Code Implementation

---

## What VaultProof Is

A developer security tool that protects API keys at the moment they are used — not just at rest.

The core insight: every secrets manager (Vault, Doppler, AWS SM, Infisical) protects keys at rest but the moment the app retrieves the key it becomes a plaintext string in memory. That is where supply chain attacks like Trivy (March 2026) and Axios npm (March 2026) harvested credentials from thousands of CI/CD pipelines including Cisco.

VaultProof eliminates the plaintext key from the application environment entirely using Shamir Secret Sharing and a proxy architecture.

---

## The Core Architecture

### How it works (3 layers)

**Layer 1: Shamir Secret Sharing**
- When a user registers an API key with VaultProof, it is split into N shares using Shamir's Secret Sharing scheme
- Any K of N shares are needed to reconstruct the key (threshold scheme)
- Individual shares are mathematically useless — knowing K-1 shares gives zero information about the key
- Shares are distributed across separate storage
- The application only ever handles shares, never the full key

**Layer 2: Proxy Reconstruction**
- When the app needs to make an API call, the VaultProof proxy collects the required shares
- The proxy reconstructs the key in memory for the duration of the API call only (milliseconds)
- The proxy makes the actual API call to the third-party service
- After the call completes, the reconstructed key is zeroed from memory
- The application never sees the full key — it only sees the API response

**Layer 3: Zero-Knowledge Proofs (future roadmap)**
- Built with Noir circuits (Aztec ZK DSL)
- Proves a key was used correctly without revealing the key
- Not in scope for current build

---

## What Is Currently Shipped

- CLI — command line tool for key registration and management
- JavaScript SDK — drop-in replacement for API clients in Node.js
- Python SDK — drop-in replacement for API clients in Python
- Proxy layer — HTTP proxy for key reconstruction and API call forwarding
- vaultproof.dev — product website

---

## What We Are Building Now

### Priority 1: Zero-friction onboarding via environment variable swap

**The problem with the existing SDK approach:**
The existing integration requires developers to:
1. npm install @vaultproof/sdk
2. Change every import statement
3. Change every API call to use vp.proxy() syntax

For vibe coders (non-developers building with AI tools) this is too much friction.

**The new approach: environment variable swap**
Every major AI and payment SDK supports a configurable base URL via environment variable. VaultProof intercepts at this layer so zero code changes are required.

```bash
# Before
OPENAI_API_KEY=sk-proj-abc123

# After — VaultProof rewrites .env automatically
OPENAI_BASE_URL=https://proxy.vaultproof.dev/openai
OPENAI_API_KEY=vp-proj-xyz789
```

The developer's code does not change. The SDK reads the base URL, routes to VaultProof proxy, proxy reconstructs key from Shamir shares, makes real API call, returns response.

---

## Build Specification

### Feature 1: `npx vaultproof init` CLI command

**What it does:**
1. Scans the current directory for .env, .env.local, .env.production files
2. Identifies API keys by pattern matching
3. Shows the user what it found
4. Splits each key into Shamir shares via the VaultProof API
5. Rewrites the .env file with VaultProof project IDs and base URLs
6. Confirms the keys are now protected

**API key patterns to detect:**
```
OpenAI:     sk-proj-[a-zA-Z0-9]{48}  or  sk-[a-zA-Z0-9]{48}
Anthropic:  sk-ant-api[0-9]{2}-[a-zA-Z0-9-]{90}
Stripe live: sk_live_[a-zA-Z0-9]{24}
Stripe test: sk_test_[a-zA-Z0-9]{24}
AWS key ID:  AKIA[0-9A-Z]{16}
AWS secret:  [a-zA-Z0-9/+=]{40}  (context dependent)
GitHub PAT:  ghp_[a-zA-Z0-9]{36}  or  github_pat_[a-zA-Z0-9_]{82}
Plaid:      [a-zA-Z0-9]{56}
```

**Output format:**
```
VaultProof — scanning .env...

Found 4 API keys:
  ✓ OPENAI_API_KEY     sk-proj-Ab3x...  (OpenAI)
  ✓ STRIPE_SECRET_KEY  sk_live_4xT7...  (Stripe)
  ✓ ANTHROPIC_API_KEY  sk-ant-api03...  (Anthropic)
  ✗ DATABASE_URL       postgres://...   (skipping — not an API key)

Protecting 3 keys via Shamir splitting...

Done. Your .env has been updated:
  OPENAI_API_KEY → protected via proxy
  STRIPE_SECRET_KEY → protected via proxy
  ANTHROPIC_API_KEY → protected via proxy

Your code does not need to change.
Run: source .env
```

**How .env is rewritten:**

For OpenAI:
```bash
# VaultProof protected — do not edit manually
OPENAI_BASE_URL=https://proxy.vaultproof.dev/openai
OPENAI_API_KEY=vp-[project-id]
```

For Anthropic:
```bash
ANTHROPIC_BASE_URL=https://proxy.vaultproof.dev/anthropic
ANTHROPIC_API_KEY=vp-[project-id]
```

For Stripe:
```bash
# Stripe uses constructor override, not env var
# VaultProof injects via SDK wrapper automatically
VAULTPROOF_STRIPE_PROJECT=vp-[project-id]
```

For AWS:
```bash
AWS_ENDPOINT_URL=https://proxy.vaultproof.dev/aws
# AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY replaced with VP equivalents
```

For GitHub:
```bash
VAULTPROOF_GITHUB_PROJECT=vp-[project-id]
```

**Backup behavior:**
Before rewriting .env, create .env.backup with a timestamp. Never destroy the original keys without backup.

---

### Feature 2: Local proxy server

**Command:**
```bash
npx vaultproof start
```

**What it does:**
- Starts a local HTTP proxy server on port 3111
- Accepts requests at provider-specific routes
- Authenticates using VaultProof project ID
- Reconstructs Shamir shares into complete key
- Forwards request to real provider
- Returns response to caller
- Zeros key from memory after call

**Routes:**
```
POST /openai/*         → https://api.openai.com/*
POST /anthropic/*      → https://api.anthropic.com/*
POST /stripe/*         → https://api.stripe.com/*
POST /aws/*            → https://[service].amazonaws.com/*
POST /github/*         → https://api.github.com/*
```

**Authentication:**
Each request must include VaultProof project ID in Authorization header or via environment variable. The project ID is not a secret — it is just an identifier. The actual key material lives in VaultProof's distributed share storage.

**Request flow:**
```
App makes API call
  → Local proxy receives request
  → Extracts VP project ID from auth header
  → Calls VP API to collect Shamir shares
  → Reconstructs complete key in memory
  → Makes real API call with complete key
  → Receives response from provider
  → Zeros key from memory
  → Returns response to app
```

**Performance target:**
- Proxy overhead: under 50ms per call
- Key reconstruction: under 10ms
- Memory residence of complete key: duration of API call only

---

### Feature 3: Cloud proxy endpoint

**Production endpoint:**
```
https://proxy.vaultproof.dev/{provider}/v1/{path}
```

Examples:
```
https://proxy.vaultproof.dev/openai/v1/chat/completions
https://proxy.vaultproof.dev/anthropic/v1/messages
https://proxy.vaultproof.dev/stripe/v1/charges
```

Same architecture as local proxy but hosted. Zero setup for developers who do not want to run a local process.

**Authentication:**
```
Authorization: Bearer vp-[project-id]
```

---

### Feature 4: Git history scanner

**Command:**
```bash
npx vaultproof scan
```

**What it does:**
- Runs git log --all -p on the current repository
- Searches for API key patterns in every commit including deleted files
- Reports exactly where each key appears
- Offers to rotate the exposed keys immediately

**Output format:**
```
VaultProof — scanning git history...

⚠️  Found exposed credentials:

OPENAI_API_KEY
  Commit: abc123f (3 weeks ago) "add openai integration"
  File:   src/config.js line 4
  Key:    sk-proj-Ab3x... (STILL ACTIVE)
  
STRIPE_SECRET_KEY  
  Commit: def456a (2 months ago) "initial stripe setup"
  File:   .env (deleted in commit 789xyz)
  Key:    sk_live_4xT7... (STILL ACTIVE)

2 active keys found in git history.
These keys are permanently in your git history.
Anyone with access to this repo can find them.

Options:
  [1] Rotate and protect all exposed keys (recommended)
  [2] Rotate only (no VaultProof protection)
  [3] Show me the commands to do this manually
  [4] Skip
```

**Key rotation:**
For supported providers, VaultProof calls the provider API to revoke the old key and generate a new one automatically. Supported:
- OpenAI: calls /v1/api_keys/revoke
- Stripe: calls /v1/keys/{id}/roll
- GitHub: revokes PAT via API

**Git history scrubbing commands (generated for user):**
```bash
# VaultProof generates these commands for you to run:
pip install git-filter-repo
echo "sk-proj-Ab3x...==>REDACTED" > replacements.txt
git filter-repo --replace-text replacements.txt
git push --force
```

---

### Feature 5: API key scanner (web tool)

A web-based tool at vaultproof.dev/scan where developers can:
- Paste code or a GitHub repo URL
- See all exposed API keys highlighted
- Get immediate protection via VaultProof signup

This is the viral acquisition tool. Someone pastes their vibe-coded app, sees their Stripe key highlighted in red, signs up immediately.

**Input types:**
- Paste raw code
- GitHub repo URL (public repos only)
- GitHub Gist URL

**Detection output:**
```
Found 3 exposed keys in your code:

Line 12: OPENAI_API_KEY="sk-proj-Ab3x..."  ⚠️ EXPOSED
Line 28: STRIPE_SECRET_KEY="sk_live_4xT7..."  ⚠️ EXPOSED  
Line 45: DATABASE_URL="postgres://..."  ✓ not an API key

These keys can be stolen by anyone who reads this code.
VaultProof protects them at the moment of use.
[Protect these keys — free]
```

---

## Supported Providers

### Priority 1 (build first)

| Provider | Env var override | Notes |
|----------|-----------------|-------|
| OpenAI | OPENAI_BASE_URL | Official support |
| Anthropic | ANTHROPIC_BASE_URL | Official support |
| Stripe | Constructor host param | Minor code change |
| AWS | AWS_ENDPOINT_URL | Official support |
| GitHub | Constructor baseUrl | Minor code change |

### Priority 2 (build next)

| Provider | Method | Notes |
|----------|--------|-------|
| Plaid | Constructor basePath | |
| Coinbase | Constructor baseUrl | |
| Twilio | Constructor edge | |
| SendGrid | Constructor host | |
| Braintree | Environment enum | |

---

## Tech Stack

**CLI:**
- Node.js + TypeScript
- Commander.js for CLI framework
- dotenv for .env parsing
- shamir-secret-sharing npm package for Shamir implementation
- axios for HTTP requests

**Local proxy:**
- Node.js + TypeScript
- Express or Fastify for HTTP server
- http-proxy-middleware for request forwarding
- Port 3111 default

**Storage for shares:**
- Supabase (already in use) for share storage
- Shares stored encrypted at rest
- Threshold: 3 of 5 shares required for reconstruction

**Testing:**
- Jest for unit tests
- Integration tests for each provider proxy
- Test that original key never appears in process.env during proxy call

---

## Security Requirements

1. The complete API key MUST NEVER appear in:
   - process.env of the calling application
   - Log files
   - Error messages
   - Network requests (except the final call to the provider)
   - Memory beyond the reconstruction window

2. Key reconstruction MUST:
   - Happen in an isolated function scope
   - Zero the reconstructed key variable after the API call completes
   - Not persist the key across multiple requests

3. Shares MUST:
   - Be stored in separate locations
   - Be encrypted at rest
   - Require authentication to retrieve
   - Never be logged

4. The project ID (vp-proj-xyz) IS NOT A SECRET:
   - It is a public identifier
   - It cannot be used to retrieve shares without additional authentication
   - It can safely appear in environment variables and code

---

## User Flow — Complete Onboarding

```
Developer discovers VaultProof
          ↓
Runs: npx vaultproof init
          ↓
CLI scans .env and shows what it found
          ↓
Developer confirms: "protect these 3 keys"
          ↓
CLI creates VaultProof account (or uses existing)
          ↓
CLI splits each key into Shamir shares
          ↓
Shares stored in VaultProof distributed storage
          ↓
.env rewritten with project IDs and base URLs
          ↓
Developer runs: source .env
          ↓
App runs — code unchanged — keys protected
          ↓
Every API call routes through VaultProof proxy
          ↓
Key reconstructed for milliseconds, then zeroed
```

---

## User Flow — Git History Scan

```
Developer suspects they have leaked keys
          ↓
Runs: npx vaultproof scan
          ↓
CLI scans git history
          ↓
Shows exactly which commits contain which keys
          ↓
Developer selects: "rotate and protect all"
          ↓
CLI calls provider APIs to revoke old keys
          ↓
New keys split via Shamir immediately
          ↓
.env updated
          ↓
CLI provides git filter-repo commands
          ↓
Developer scrubs git history
```

---

## CLI Commands Reference

```bash
# Initialize — scan .env and protect all keys found
npx vaultproof init

# Start local proxy server
npx vaultproof start [--port 3111]

# Scan git history for exposed keys
npx vaultproof scan [--repo /path/to/repo]

# Add a specific key manually
npx vaultproof add --name OPENAI_API_KEY --key sk-proj-...

# List all protected keys in current project
npx vaultproof list

# Rotate a specific key
npx vaultproof rotate --name OPENAI_API_KEY

# Test that proxy is working for a provider
npx vaultproof test --provider openai

# Show status of all shares
npx vaultproof status
```

---

## Error Handling

**Key not found in storage:**
```
Error: Could not retrieve shares for project vp-abc123
This usually means:
  1. The project ID is wrong
  2. Your VaultProof session has expired (run: npx vaultproof login)
  3. The shares have been rotated (run: npx vaultproof rotate)
```

**Proxy timeout:**
SDK falls back to direct API call if VaultProof proxy is unavailable.
This is intentional — VaultProof is additive security, not a critical dependency.
Log a warning but do not break the application.

**Rate limiting:**
If the provider returns 429, pass it through unchanged to the application.

---

## Performance Targets

| Metric | Target |
|--------|--------|
| init command completion | under 5 seconds |
| Share retrieval latency | under 20ms |
| Key reconstruction time | under 5ms |
| Total proxy overhead | under 50ms |
| Memory: key existence window | API call duration only |

---

## What NOT To Build Yet

- ZK proof layer (roadmap, not current sprint)
- MCP server integration (roadmap)
- Enterprise SSO (roadmap)
- Team management UI (roadmap)
- Key rotation automation (roadmap)
- Mobile SDK (Proxed.AI owns this space for iOS)

Focus on: CLI, local proxy, cloud proxy, git scanner, web scanner tool.

---

## Competitive Context

**Proxed.AI** — closest competitor for the proxy pattern. Mobile-first (iOS DeviceCheck). Uses simple key splitting not Shamir. Their server holds the reconstructable key. VaultProof differentiator: true Shamir splitting means VaultProof never holds a reconstructable key. Also VaultProof covers backend, CI/CD, and all providers not just mobile.

**OneCLI** — proxy approach for AI agents. Decrypts full key server-side at injection time. VaultProof differentiator: same as above — we never hold the complete key.

**Doppler / Vault / Infisical** — protect at rest. Do not protect at runtime. VaultProof is complementary, not a replacement.

**GitGuardian** — detects leaks after they happen. VaultProof prevents the key from being in a leakable form.

---

## Target Users (ICP)

### Primary: Vibe coders (highest urgency, largest volume)
- Non-developers building apps with Cursor, Bolt, Lovable, Replit, v0
- Ages 18-35, indie hackers and solo founders
- Pain: AI hardcodes their API keys, they do not always catch it
- 63% are non-developers — no security knowledge
- AI-assisted commits expose secrets at 2x the rate of human commits
- Real incident: Moltbook leaked 1.5M API keys in January 2026 from vibe-coded app

### Secondary: Dev leads at Series A-C startups
- Engineering managers responsible for security posture and SOC-2
- Pain: secrets sprawl, supply chain attacks (Trivy, Axios), audit findings
- Proof point: Cisco breach via Trivy March 2026

### Tertiary: Security engineers / CISOs
- Longer sales cycle but higher ACV
- Pain: runtime gap in secrets management, board pressure post-supply chain attacks

---

## Key Proof Points For Marketing

- GitGuardian 2026: 24,000+ unique secrets leaked from MCP config files
- GitGuardian 2026: 28.65 million hardcoded secrets in public GitHub — 34% YoY increase
- AI-assisted commits leak secrets at 3.2% vs 1.5% baseline — more than double
- 113,000 DeepSeek API keys found in public repos in 2025 alone
- Trivy March 2026: Cisco breach, 300+ GitHub repos stolen via harvested CI/CD credentials
- Axios npm March 2026: Sapphire Sleet (North Korea) targeted 100M weekly download package
- Moltbook January 2026: 1.5M API keys leaked from vibe-coded app, founder wrote zero lines of code
- Japan company March 2026: $128k in unauthorized Gemini charges from leaked key
- Average cost of single compromised API key: $650,000
- 160% increase in credential compromises in 2025

---

## The One Sentence Pitch

VaultProof protects API keys at the moment they are used — the gap every secrets manager leaves open — so the full key never exists as plaintext in your application, your pipeline, or your git history.

---

## The Vibe Coder Pitch

Your AI wrote your code with the API keys hardcoded. VaultProof finds them, rotates them, and protects them in 60 seconds. Your code does not change.

---

*Last updated: April 2026*
*Version: 2.0*
*Status: Active development sprint — 21 days to 1,000 users before YC application*
