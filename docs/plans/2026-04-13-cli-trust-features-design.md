# CLI Trust Features Design
**Date:** 2026-04-13
**Status:** Approved

## Problem

Developers distrust VaultProof at three moments:
1. **Before init** — skeptical about handing keys to a third party
2. **After init** — worried something will silently break in production
3. **Breach anxiety** — unsure what exposure looks like if VaultProof is compromised

## Solution

Two targeted CLI improvements:

- **Feature A:** Transparent split output during `init` — make client-side splitting *visible* so developers understand the breach guarantee
- **Feature B:** `vaultproof doctor` command — re-runnable health check for ongoing confidence

---

## Feature A: Transparent Split Output

### Goal
Make it obvious that keys are split *before* anything leaves the developer's machine, and that neither share alone is useful.

### Changes
Single file: `packages/init-cli/src/index.ts`

**Before the per-key loop**, print a one-time header:
```
How VaultProof protects your keys:
  Your key is split into 2 shares on this machine.
  Each share is useless without the other.
  VaultProof never receives your full key.
```

**Replace the spinner success line** for each key from:
```
✓ Protected OPENAI_API_KEY (OpenAI)
```
to:
```
✓ OPENAI_API_KEY (OpenAI)
    Split locally on your machine
    Share 1 → VaultProof (encrypted at rest, useless alone)
    Share 2 → VaultProof (encrypted at rest, useless alone)
    A breach of VaultProof cannot expose this key
```

### Scope
- No new files
- No new API calls
- No new dependencies
- Copy + display change only

---

## Feature B: `vaultproof doctor` Command

### Goal
Give developers a standalone, re-runnable command that verifies the full proxy chain is healthy: worker, auth, Supabase, and each provider.

### Invocation
```bash
npx @vaultproof/init doctor
```

### Checks (run in sequence)

| Step | What it checks | Pass condition |
|------|---------------|----------------|
| 1. Worker reachability | GET `/health` on CF Worker | HTTP 200, latency shown |
| 2. Auth validity | Validates stored JWT | 200 from `/api/v1/init/projects` |
| 3. Share integrity | Lists projects + key count | At least 1 project found |
| 4. Proxy test per provider | One GET per provider through proxy | HTTP 200, 401, 404, or 405 from upstream |

Output format:
```
VaultProof — health check

  ✓ Worker reachable        (42ms)
  ✓ Auth valid              (nelson@example.com)
  ✓ Shares present          (2 projects, 5 keys)
  ✓ OpenAI proxy            (connected, 91ms)
  ✓ Stripe proxy            (connected, 88ms)
  ✗ Anthropic proxy         (timeout — check vaultproof.dev/status)

1 issue found. See https://vaultproof.dev/status for live uptime data.
```

### Implementation
- New `runDoctor()` function in `index.ts`
- New `doctor` branch in `main()` command parser
- Reuses existing `getJwt()`, `getInitWorkerUrl()`, `getProxyBaseUrl()`, `browserLogin()`
- Reuses existing proxy test logic from end-of-init flow
- No new files, no new dependencies

### Error handling
- Each check fails independently — remaining checks still run
- Timeout per check: 5 seconds
- On any failure: links to `vaultproof.dev/status`

---

## Out of Scope
- `vaultproof.audit.json` receipt (deferred to enterprise/compliance phase)
- Better Stack API integration in CLI (status page link is sufficient for now)
- CI mode / machine-readable output (future iteration)

---

## Files Changed
- `packages/init-cli/src/index.ts` — all changes land here
