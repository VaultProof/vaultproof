# vaultproof

Python SDK for [VaultProof](https://vaultproof.dev) — store and proxy API keys with split-key encryption.

Your keys are split into two shares **on your machine** before any network call. Neither share alone can reconstruct the key. VaultProof never sees your key whole.

## Install

```bash
pip install vaultproof
```

Zero dependencies. Python 3.8+.

## Quick start

```python
from vaultproof import VaultProof

vault = VaultProof("vp_live_your_key_here")

# Store an API key — split locally, shares sent to VaultProof
key = vault.store("sk-openai-...", "openai", label="Production")
print(key.id)  # "slot_abc123"

# Make a proxied API call
res = vault.proxy(key.id, "/v1/chat/completions", {
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
})
print(res.data)  # {"choices": [...]}

# List all stored keys
for k in vault.keys():
    print(k["provider"], k["label"])

# Revoke a key
vault.revoke(key.id)
```

## Transparent proxy (no SDK needed)

If you just want to proxy calls without storing keys programmatically, any HTTP client works:

```python
import openai

client = openai.OpenAI(
    api_key="vp_live_your_key_here",
    base_url="https://api.vaultproof.dev/v1/openai"
)
```

## Duplicate handling

If a key for the same `(provider, label)` pair already exists:

```python
# Default: warns but stores anyway
key = vault.store("sk-openai-new", "openai", label="Production")
if key.warning:
    print(key.warning)             # "A key already exists for openai/Production"
    print(key.duplicate_key_ids)   # ["slot_old"]

# Replace: revokes old key(s), stores new one
key = vault.store("sk-openai-new", "openai", label="Production", replace=True)
```

## Error handling

```python
from vaultproof import VaultProofError

try:
    vault.revoke("nonexistent-id")
except VaultProofError as e:
    print(e)         # "Key not found"
    print(e.status)  # 404
```

## Security

- Keys are split **before** any network call — the raw key never leaves your process
- Shares travel over TLS to `api.vaultproof.dev`
- On proxy calls, shares are reconstructed in server RAM for ~100ms, then zeroed
- Zero external dependencies — easy to audit (~200 lines total)

## Get your API key

Sign up free at [vaultproof.dev](https://vaultproof.dev) — no credit card required.
