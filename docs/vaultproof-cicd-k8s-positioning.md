# VaultProof In CI/CD + Kubernetes

This is a short positioning guide for teams already running CI/CD pipelines, Kubernetes, and a standard secrets stack.

## What VaultProof Does

VaultProof is a proxy-based credential protection layer for third-party API keys (OpenAI, Anthropic, Stripe, etc.).

At setup time (`npx @vaultproof/init`), VaultProof:
1. Finds provider keys in your `.env`.
2. Splits each key into 2 shares locally.
3. Stores encrypted shares server-side.
4. Rewrites runtime config so your app uses a public `vp-proj-...` identifier + provider proxy base URLs.

At request time, the proxy reconstructs the provider key briefly in memory, forwards the request upstream, then zeroes the buffer.

## Before vs After Integration

### Before (typical setup)

Your app/pipeline/pod usually stores raw provider keys:

```env
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
```

Those values may spread into CI variables, pod env, logs, crash dumps, debug shells, or copied config.

### After (VaultProof)

Your runtime stores only the project identifier and proxy URLs:

```env
VAULTPROOF_PROJECT_ID=vp-proj-...
OPENAI_API_KEY=vp-proj-...
OPENAI_BASE_URL=https://init.vaultproof.dev/p/openai/v1
```

Your SDK usage stays mostly unchanged. Calls route through VaultProof instead of directly to the provider.

## Example: GitHub Actions

```yaml
env:
  VAULTPROOF_PROJECT_ID: ${{ secrets.VAULTPROOF_PROJECT_ID }}
  OPENAI_API_KEY: ${{ secrets.VAULTPROOF_PROJECT_ID }}
  OPENAI_BASE_URL: https://init.vaultproof.dev/p/openai/v1
```

## Example: Kubernetes

```bash
kubectl create secret generic app-env \
  --from-literal=VAULTPROOF_PROJECT_ID=vp-proj-... \
  --from-literal=OPENAI_API_KEY=vp-proj-... \
  --from-literal=OPENAI_BASE_URL=https://init.vaultproof.dev/p/openai/v1
```

Important: for server-to-server callers that do not send browser `Origin` headers, keep strict origin enforcement disabled for that project.

## Threat Classes Covered

### Strongly Reduced

- Plaintext provider key leaks from app env files and CI variables.
- Secret exposure through accidental commit/copy/paste of provider keys.
- Lateral spread of raw provider keys across multiple services/jobs.

### Mitigated (but not eliminated)

- Stolen `vp-proj-...` identifier: attacker can attempt proxy usage, but does not directly recover raw provider keys.
- Upstream abuse from leaked identifier: constrained by per-project rate limits and optional origin controls.

### Out of Scope / Not Fully Solved

- Full compromise of both VaultProof share storage and encryption-key control plane.
- Workload compromise that can freely call external APIs as your service identity.
- Non-HTTP secrets (DB passwords, private keys, internal service credentials).
- Business-logic abuse and prompt-injection style misuse at application level.

## Where It Sits Relative To Existing Stack

VaultProof is not a full replacement for Vault/Secrets Manager/KMS.

It is an additional control plane for outbound third-party API credentials:
- Keep your existing secrets manager for general infrastructure secrets.
- Use VaultProof specifically for high-risk provider API keys and agent-facing keys.
- Treat VaultProof as the egress credential enforcement/proxy layer, not your entire secret lifecycle system.
