# VaultProof Pitch Deck Design

**Date:** 2026-03-31
**Format:** HTML → Print to PDF
**Audience:** Angels, VCs, general investor meetings
**Style:** Nicolas Cole — short, punchy, confident
**Branding:** Dark bg (#0a0a0f), indigo accent (#6366f1), cyan (#06b6d4), Space Grotesk headings, Inter body

## Slides (9 total)

### 1. Cover
- VaultProof logo centered
- Tagline: "The password manager for API keys."
- Dark background, subtle indigo-to-cyan gradient accent

### 2. Problem
- Headline: "Every AI company has the same hidden vulnerability."
- API keys live in .env files, config repos, and Slack messages
- One leaked key = unlimited spend on someone else's credit card
- Every secrets manager on the market hands the raw key back to your app

### 3. Solution
- Headline: "VaultProof never returns the key. It uses it for you."
- Visual: Your App → VaultProof Proxy → AI Provider
- Key stays inside VaultProof, response flows back, code never touches the secret

### 4. How It Works
- Headline: "Split. Proxy. Zero."
- Split — Key is Shamir-split into 2 encrypted shares on store
- Proxy — App calls VaultProof, server reconstructs key, forwards request
- Zero — Key wiped from memory in ~100ms. Never sent to client.

### 5. Market Size
- Headline: "AI API spend is exploding."
- TAM / SAM / SOM with current AI API market figures

### 6. Business Model
- Headline: "SaaS pricing that scales with usage."
- Tiers: Free $0 / Starter $5 / Pro $15 / Team $39 / Enterprise custom
- Upsell triggers: more API calls, providers, team seats, security features

### 7. Competition
- Headline: "They give you the key. We use it for you."
- Comparison table: VaultProof vs AWS Secrets Manager vs HashiCorp Vault vs Doppler
- Key differentiator row: "Key returned to app?" — Everyone else: Yes. VaultProof: No.

### 8. Why Now
- Headline: "Three forces converging."
- AI API spend growing exponentially
- Key leaks becoming front-page incidents
- No one has built a proxy-first security layer — until now

### 9. Use of Funds
- Headline: "Where the capital goes."
- Engineering (auto-migration tool, MCP server)
- Go-to-market (developer community, content)
- Infrastructure (scaling proxy edge network)
- Security (continued audits, SOC 2)

## Implementation
- Single HTML file at `apps/site/pitch.html`
- Print-optimized CSS with `@page` rules for landscape slides
- Each slide is a `<section>` that maps to one printed page
- Open in Chrome → Print → Save as PDF
