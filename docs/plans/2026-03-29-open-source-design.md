# Open Source Design: VaultProof Public Repo

**Date:** 2026-03-29
**Status:** Approved

## Goal

Build trust with security-conscious users by open sourcing the client-side cryptographic code — the parts that run on the user's machine and prove keys are split before any network request is made.

## Decision

Open source **shamir, ZK circuits, SDK, and CLI** under MIT license. Keep backend, worker, dashboard, site, and extensions private.

**Why not open source the backend:** The architecture is designed so the backend is irrelevant to the user's security guarantee. The trust argument is stronger when framed as "you don't need to trust our servers" rather than "trust our open source backend."

## Repo

- **Name:** `github.com/vaultproof/vaultproof` (public)
- **License:** MIT
- **Source:** New repo, not the existing private monorepo

## Packages Included

| Package | Purpose |
|---|---|
| `packages/shamir` | Shamir secret sharing over GF(256) — proves keys are split in the browser |
| `packages/circuits` | Noir ZK circuits — proves authorization logic is sound |
| `packages/sdk` | `@vaultproof/sdk` — runs client-side, handles splitting |
| `packages/cli` | `@vaultproof/cli` — runs on user's machine |

## Packages Excluded

- `packages/backend` — server-side key reconstruction, billing, auth
- `packages/worker` — CF Worker proxy (infra-specific)
- `apps/dashboard` — frontend app
- `apps/site` — marketing site
- `packages/extension` — Chrome extension
- `packages/safari-extension` — Safari extension
- `packages/monitor` — uptime monitoring
- `packages/widget` — embeddable widget

## Trust Narrative

README headline: *"You don't need to trust our servers. Your key is split into two shares in your browser before any network request is made. One share never leaves your device. Here's the code that does it."*

This reframes trust from "believe our backend is safe" to "the architecture makes our backend irrelevant to your security."

## Pre-publish Requirements

- Scan all four packages for hardcoded secrets: API URLs, Supabase refs, Railway URLs, `vp_live_` key patterns
- Ensure no private infra details leak through package.json scripts, config files, or test fixtures

## What This Is Not

- Not a self-hostable version of VaultProof
- Not an open core model
- Not a full audit of the backend
