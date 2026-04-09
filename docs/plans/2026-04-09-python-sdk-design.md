# VaultProof Python SDK — Design Doc

**Date:** 2026-04-09
**Status:** Approved, ready for implementation

## Overview

A Python SDK (`vaultproof` on PyPI) with full parity to the JS SDK (`@vaultproof/sdk`). The same security model: API keys are Shamir-split **client-side** before any network call. The raw key never leaves the user's process.

## Goals

- Python developers get a native `pip install vaultproof` experience
- Identical security model to the JS SDK (GF(256) Shamir, client-side)
- Zero external dependencies (stdlib only)
- Works on Python 3.8+ — scripts, notebooks, Lambda, CI pipelines

## What's Not Included

- Async client (add later if requested — would need `httpx`)
- Session tokens (legacy JS SDK feature, not needed here)
- Type stubs / `.pyi` files (inline annotations are sufficient)

---

## Package Structure

```
packages/python-sdk/
├── vaultproof/
│   ├── __init__.py       # exports VaultProof, StoredKey, VaultProofError
│   ├── client.py         # VaultProof class
│   ├── shamir.py         # Pure Python GF(256) Shamir implementation
│   └── exceptions.py     # VaultProofError
├── tests/
│   ├── test_shamir.py    # round-trip split/combine, cross-language wire format
│   └── test_client.py    # mocked HTTP tests for all 4 methods
└── pyproject.toml        # name="vaultproof", python>=3.8, no deps
```

---

## API

```python
from vaultproof import VaultProof

vault = VaultProof("vp_live_abc123")

# Store — Shamir splits locally, sends shares (not raw key)
key = vault.store("sk-openai-...", "openai", label="Production")
# key.id              → "slot_abc123"
# key.provider        → "openai"
# key.label           → "Production"
# key.warning         → "A key already exists for openai/Production" | None
# key.duplicate_key_ids → ["old-slot-id"] | None

# Replace existing key atomically (revokes duplicate, stores new)
key = vault.store("sk-openai-new", "openai", label="Production", replace=True)

# Proxy a call through VaultProof
res = vault.proxy(key.id, "/v1/chat/completions", {"model": "gpt-4o", "messages": [...]})
# res.status → 200
# res.data   → {"choices": [...]}
# res.ok     → True

# List all stored keys
keys = vault.keys()
# [{"id": "...", "provider": "openai", "label": "Production", "created_at": "..."}]

# Revoke a key (both shares zeroed on server)
vault.revoke(key.id)
```

### Duplicate handling

Duplicates are matched by `(provider, label)` pair. Two OpenAI keys with different labels are **not** duplicates.

- Default: store anyway, return `warning` + `duplicate_key_ids` in the result
- `replace=True`: auto-revoke all duplicates, then store — one atomic call from the user's perspective (two API calls internally: revoke each duplicate, then store)

---

## Shamir Implementation (`shamir.py`)

GF(256) using the AES irreducible polynomial `x^8 + x^4 + x^3 + x + 1` (`0x11b`). Identical math to `packages/shamir/src/index.ts`.

**Wire format** (must match JS SDK exactly for server compatibility):

```
serialized_share = base64( bytes([x]) + y_bytes )
```

Where `x` is the share index (1-based, 1 byte) and `y_bytes` is the share data (same length as the UTF-8 encoded secret).

**Split (2-of-2):**
1. Encode secret as UTF-8 bytes
2. For each byte: generate a degree-1 polynomial over GF(256) with the secret byte as constant term and a random byte as the x coefficient
3. Evaluate at x=1 → share 1 y-value; evaluate at x=2 → share 2 y-value
4. Serialize each share as `base64(bytes([x]) + y_bytes)`

**Lookup tables:** Pre-compute `EXP_TABLE[512]` and `LOG_TABLE[256]` at module import using the same generator polynomial as the JS implementation.

---

## HTTP Endpoints Used

All existing — no new server endpoints needed:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/sdk/store` | Store pre-split shares |
| POST | `/api/v1/sdk/call` | Proxied API call |
| GET | `/api/v1/sdk/keys` | List stored keys |
| POST | `/api/v1/sdk/revoke` | Revoke a key |

Auth header: `X-API-Key: vp_live_...` on every request.

---

## Testing Strategy

**`test_shamir.py`:**
- Split → combine round-trip (recovers original string)
- Cross-language compatibility: verify a share serialized by the Python SDK deserializes identically to the JS SDK's format (use a known test vector)
- Edge cases: empty string, unicode, very long key, single-byte secret

**`test_client.py`:**
- Mock `urllib.request.urlopen` for all 4 methods
- `store()`: happy path, duplicate warning path, `replace=True` path
- `proxy()`: 200 response, non-200 response
- `keys()`: empty list, multiple keys
- `revoke()`: success, key-not-found error
- Invalid API key raises `VaultProofError` on construction

---

## pyproject.toml (key fields)

```toml
[project]
name = "vaultproof"
version = "1.0.0"
description = "Store and proxy API keys with split-key encryption. Keys are split on your machine — we never see them whole."
requires-python = ">=3.8"
dependencies = []  # zero deps

[project.urls]
Homepage = "https://vaultproof.dev"
Documentation = "https://vaultproof.dev/docs"
Repository = "https://github.com/VaultProof/vaultproof"
```
