# ProveIP — ZK IP Vault with Programmable Claims

**Date:** 2026-04-06
**Status:** Approved
**Author:** Nelson

## Problem

Intellectual property theft costs ~$1.8T/year globally. Startups face four acute pain points:

1. **The Patent Gap** — Patents take 2+ years and $10-15K minimum. Startups are unprotected during that window.
2. **Contractor/Co-founder Ownership** — Without signed IP assignments, freelancers own the copyright by default. Unclear ownership kills investor deals.
3. **Trade Secret Documentation** — Winning a trade secret case requires "clear and convincing evidence" of prior use. Most startups have no systematic documentation.
4. **"Show Without Showing"** — Startups need to prove capabilities to investors/partners without revealing the IP itself. NDAs are weak and unenforceable cross-border.

## Market

- IP management software market: ~$13-15B in 2026, growing 10-13% CAGR
- ZK proof market: ~$1.3B in 2024, projected $7.2B by 2033 (22-27% CAGR)
- IP theft: $1.8T/year globally, 45% of companies report IP-targeted cyberattacks
- Legal milestone: French court recognized blockchain timestamps as IP evidence (March 2025)

## Competitors

| Competitor | Approach | Gap |
|---|---|---|
| Bernstein.io | Bitcoin blockchain timestamps | No ZK — just hashes, can't prove properties without revealing IP |
| IPwe | Patent portfolio management + blockchain | Enterprise-focused, no proof-of-existence for pre-patent IP |
| Verisart | Digital certificates + NFTs | Art/brand focused, no programmable claims |
| Blockai | Blockchain timestamps for creators | Indie creators only, no dispute resolution |

**Our differentiator:** Programmable ZK claims — prove *properties* about your IP without revealing it. Nobody else does this.

## Target User

Startups protecting pre-patent ideas and trade secrets. Beachhead market, then expand to indie creators (volume) and enterprise/legal (revenue).

## Core Architecture

```
Frontend (Next.js + Tailwind + shadcn/ui)
  Upload | Claims Builder | Dispute | Dashboard
    │
API Layer (CF Workers + Hono)
  Auth | File Processing | Proof Mgmt | Billing
    │           │              │
Supabase    ZK Engine       On-Chain Anchor
  Auth        Noir            Base L2
  DB          Circuits        Merkle Root
  Storage
```

### Key Principle

The raw file never touches the server. Only the hash and ZK proof do. File is hashed client-side.

### Flow

1. User uploads a file (code, doc, model, design — anything)
2. File is hashed client-side (never leaves the browser in raw form)
3. User selects or builds claims about the file
4. Noir circuit generates a ZK proof binding: file hash + claims + timestamp + user identity
5. Proof stored in Supabase, hash committed to a Merkle tree
6. Merkle root anchored to Base L2 daily (batch — ~$0.01/day)
7. User gets a proof certificate (shareable link, downloadable PDF, or API-verifiable)

## Claims System

Built-in claim types for v1:

| Claim Type | Example | ZK Circuit |
|---|---|---|
| Existence | "I had this file at time X" | Hash + timestamp binding |
| Authorship | "This was created by identity Y" | Hash + identity commitment |

v2 additions:

| Claim Type | Example | ZK Circuit |
|---|---|---|
| Similarity | "My work predates and is similar to Z" | Fuzzy hash comparison |
| Performance | "My model achieves X% accuracy" | Output verification circuit |
| Containment | "My codebase contains algorithm X" | Pattern membership proof |

## Dispute Resolution

```
Claimant A                    ProveIP                     Claimant B
    |                            |                            |
    |-- Submits proof ---------->|                            |
    |                            |<------ Submits proof ------|
    |                            |                            |
    |                     [ZK Verifier]                       |
    |                     Compares:                           |
    |                     - Timestamps                        |
    |                     - Claims                            |
    |                     - Hashes                            |
    |                            |                            |
    |<-- Verdict Certificate ----|---- Verdict Certificate -->|
```

- Neither party reveals their actual IP to ProveIP or each other
- Verdict certificate is on-chain anchored — admissible as evidence
- Optional: invite a neutral third-party verifier for higher-stakes disputes

## Data Model

```
users           -> Supabase Auth
  proofs        -> id, user_id, file_hash, claim_type,
                   noir_proof, merkle_leaf, status, created_at
  claims        -> id, proof_id, claim_type, claim_params,
                   verified_at
  anchors       -> id, merkle_root, chain_tx_hash,
                   anchor_date, proof_count
  disputes      -> id, claimant_a, claimant_b, proof_a_id,
                   proof_b_id, verdict, resolved_at
  certificates  -> id, proof_id, public_url, expires_at
```

## Tech Stack

- **Frontend:** Next.js 15 + Tailwind + shadcn/ui
- **API:** Cloudflare Workers + Hono
- **Auth:** Supabase Auth
- **DB:** Supabase Postgres
- **Storage:** Supabase Storage (encrypted proof artifacts only — never raw files)
- **ZK:** Noir (Aztec)
- **Chain:** Base L2
- **Payments:** Stripe

## Business Model

- **Free:** 5 proofs/month, basic verification
- **Pro ($29/mo):** Unlimited proofs, team access, API, export for legal use
- **Dispute resolution:** Per-case fee ($99-299)

## MVP Scope (v1)

- Upload & prove (existence + authorship claims only)
- Proof certificates (shareable link + PDF)
- Daily Merkle root anchoring to Base
- Basic dispute flow (timestamp comparison)
- Free tier (5 proofs/mo) + Pro ($29/mo)

## v2 Roadmap

- Performance + similarity + containment claims
- Full adversarial dispute resolution
- API access
- Team workspaces
- Per-dispute pricing ($99-299)
