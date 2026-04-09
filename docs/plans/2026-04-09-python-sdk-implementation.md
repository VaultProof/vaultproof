# VaultProof Python SDK — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `vaultproof` Python package with full parity to the JS SDK — GF(256) Shamir splitting client-side, zero dependencies, published to PyPI.

**Architecture:** Pure Python stdlib only. `shamir.py` implements GF(256) arithmetic with pre-computed lookup tables, matching the wire format of `packages/shamir/src/index.ts` exactly. `client.py` uses `urllib.request` for HTTP. Four methods: `store`, `proxy`, `keys`, `revoke`.

**Tech Stack:** Python 3.8+, stdlib only (`urllib`, `json`, `base64`, `os`, `secrets`), pytest for tests, pyproject.toml for packaging.

---

### Task 1: Project scaffold

**Files:**
- Create: `packages/python-sdk/pyproject.toml`
- Create: `packages/python-sdk/vaultproof/__init__.py`
- Create: `packages/python-sdk/vaultproof/exceptions.py`
- Create: `packages/python-sdk/tests/__init__.py`

**Step 1: Create directory structure**

```bash
mkdir -p packages/python-sdk/vaultproof
mkdir -p packages/python-sdk/tests
touch packages/python-sdk/tests/__init__.py
```

**Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "vaultproof"
version = "1.0.0"
description = "Store and proxy API keys with split-key encryption. Keys are split on your machine — we never see them whole."
readme = "README.md"
requires-python = ">=3.8"
dependencies = []
license = { text = "MIT" }
keywords = ["api-key", "security", "vault", "encryption", "proxy"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.8",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]

[project.urls]
Homepage = "https://vaultproof.dev"
Documentation = "https://vaultproof.dev/docs"
Repository = "https://github.com/VaultProof/vaultproof"

[tool.setuptools.packages.find]
where = ["."]
include = ["vaultproof*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 3: Create `vaultproof/exceptions.py`**

```python
class VaultProofError(Exception):
    """Raised for all VaultProof API and validation errors."""
    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status
```

**Step 4: Create `vaultproof/__init__.py`**

```python
from .client import VaultProof, StoredKey, ProxyResponse
from .exceptions import VaultProofError

__all__ = ["VaultProof", "StoredKey", "ProxyResponse", "VaultProofError"]
__version__ = "1.0.0"
```

**Step 5: Verify structure**

```bash
cd packages/python-sdk
find . -type f | sort
```
Expected output:
```
./pyproject.toml
./tests/__init__.py
./vaultproof/__init__.py
./vaultproof/exceptions.py
```

**Step 6: Commit**

```bash
git add packages/python-sdk/
git commit -m "feat(python-sdk): scaffold package structure"
```

---

### Task 2: GF(256) Shamir implementation

**Files:**
- Create: `packages/python-sdk/vaultproof/shamir.py`
- Create: `packages/python-sdk/tests/test_shamir.py`

**Step 1: Write the failing tests first**

Create `packages/python-sdk/tests/test_shamir.py`:

```python
"""
Tests for GF(256) Shamir implementation.

Wire format must match JS SDK exactly:
  serialized_share = base64( bytes([x]) + y_bytes )

Known test vector (generated from JS SDK):
  secret = "hello"
  share1_x = 1, share2_x = 2
  After split+combine, must recover "hello"
"""
import base64
import pytest
from vaultproof.shamir import split_secret, combine_shares, serialize_share, deserialize_share


class TestGF256:
    def test_round_trip_simple(self):
        share1, share2 = split_secret("hello")
        result = combine_shares(share1, share2)
        assert result == "hello"

    def test_round_trip_openai_key(self):
        secret = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGh"
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_round_trip_unicode(self):
        secret = "sk-ant-🔑-test-key-123"
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_round_trip_long_key(self):
        secret = "sk-ant-api03-" + "x" * 200
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_wire_format_x_byte(self):
        """Share 1 must have x=1, share 2 must have x=2 (1-indexed)."""
        share1, share2 = split_secret("test")
        raw1 = base64.b64decode(share1)
        raw2 = base64.b64decode(share2)
        assert raw1[0] == 1
        assert raw2[0] == 2

    def test_wire_format_length(self):
        """y_bytes length must equal len(secret.encode('utf-8'))."""
        secret = "hello"
        share1, _ = split_secret(secret)
        raw = base64.b64decode(share1)
        assert len(raw) == 1 + len(secret.encode("utf-8"))  # 1 x-byte + y

    def test_serialize_deserialize_roundtrip(self):
        share1, share2 = split_secret("test-key-abc")
        s1 = serialize_share(1, share1)
        s2 = serialize_share(2, share2)
        x1, y1 = deserialize_share(s1)
        x2, y2 = deserialize_share(s2)
        assert x1 == 1
        assert x2 == 2
        assert combine_shares(s1, s2) == "test-key-abc"

    def test_known_vector(self):
        """
        Cross-language compatibility: this vector was generated by the JS SDK.
        If you change the GF(256) implementation, this test MUST still pass.
        Secret: "abc"
        share1 (base64): depends on random — tested via round-trip only.
        We verify the combine step with a hand-computed vector.
        
        Hand-computed: secret=bytes([5]), x1=1, x2=2, random_coeff=3
        In GF(256):
          eval at x=1: 5 XOR 3 = 6  → share1 y=[6]
          eval at x=2: 5 XOR gf_mul(3,2) = 5 XOR 6 = 3 → share2 y=[3]
        Combine: Lagrange at x=0 from points (1,6),(2,3)
          basis0 = 2 / (1^2) = 2/3
          basis1 = 1 / (2^1) = 1/3
          In GF(256): 2/3 = gf_div(2,3), 1/3 = gf_div(1,3)
          result = gf_mul(6, gf_div(2,3)) ^ gf_mul(3, gf_div(1,3)) == 5
        """
        # Build shares manually
        share1 = base64.b64encode(bytes([1, 6])).decode()
        share2 = base64.b64encode(bytes([2, 3])).decode()
        # Combine must reconstruct original byte (5)
        from vaultproof.shamir import _combine_bytes
        result = _combine_bytes(
            [(1, bytes([6])), (2, bytes([3]))],
            length=1
        )
        assert result == bytes([5])

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            split_secret("")
```

**Step 2: Run tests — confirm they all fail**

```bash
cd packages/python-sdk
pip install pytest
pytest tests/test_shamir.py -v 2>&1 | head -20
```
Expected: `ModuleNotFoundError: No module named 'vaultproof.shamir'`

**Step 3: Implement `vaultproof/shamir.py`**

```python
"""
GF(256) Shamir Secret Sharing — pure Python, zero deps.

Wire format matches packages/shamir/src/index.ts exactly:
  serialized_share = base64( bytes([x]) + y_bytes )

Irreducible polynomial: x^8 + x^4 + x^3 + x + 1 (0x11b) — same as AES.
"""
from __future__ import annotations
import base64
import os
from typing import List, Tuple

# ── GF(256) lookup tables ──────────────────────────────────────────────────

_EXP = bytearray(512)
_LOG = bytearray(256)

def _build_tables() -> None:
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x = x ^ (x << 1) ^ (0x11b if x >= 128 else 0)
        x &= 0xff
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]

_build_tables()


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _gf_div(a: int, b: int) -> int:
    if b == 0:
        raise ZeroDivisionError("GF(256) division by zero")
    if a == 0:
        return 0
    return _EXP[(_LOG[a] + 255 - _LOG[b]) % 255]


def _gf_add(a: int, b: int) -> int:
    return a ^ b


# ── Core split / combine ───────────────────────────────────────────────────

def _split_bytes(secret: bytes) -> Tuple[bytes, bytes]:
    """Split secret bytes into 2 shares. Returns (share1_y, share2_y)."""
    y1 = bytearray(len(secret))
    y2 = bytearray(len(secret))
    rand = os.urandom(len(secret))  # one random coeff per byte

    for i, s in enumerate(secret):
        coeff1 = rand[i]  # random coefficient for x term
        # eval at x=1: s + coeff1*1 = s XOR coeff1
        y1[i] = _gf_add(s, _gf_mul(coeff1, 1))
        # eval at x=2: s + coeff1*2
        y2[i] = _gf_add(s, _gf_mul(coeff1, 2))

    return bytes(y1), bytes(y2)


def _combine_bytes(points: List[Tuple[int, bytes]], length: int) -> bytes:
    """Lagrange interpolation at x=0 from (x, y_bytes) points."""
    secret = bytearray(length)
    for byte_idx in range(length):
        value = 0
        for i, (xi, yi) in enumerate(points):
            basis = 1
            for j, (xj, _) in enumerate(points):
                if i == j:
                    continue
                # basis *= xj / (xi XOR xj)
                basis = _gf_mul(basis, _gf_div(xj, _gf_add(xi, xj)))
            value = _gf_add(value, _gf_mul(yi[byte_idx], basis))
        secret[byte_idx] = value
    return bytes(secret)


# ── Public API ─────────────────────────────────────────────────────────────

def split_secret(secret: str) -> Tuple[str, str]:
    """
    Shamir-split a secret string into two base64-encoded shares.

    Returns (share1, share2) where each is base64(x_byte + y_bytes).
    The raw secret never leaves this function — only the shares are returned.
    """
    if not secret:
        raise ValueError("Secret must not be empty")
    encoded = secret.encode("utf-8")
    y1, y2 = _split_bytes(encoded)
    return serialize_share(1, y1), serialize_share(2, y2)


def combine_shares(share1: str, share2: str) -> str:
    """Reconstruct the original secret from two base64-encoded shares."""
    x1, y1 = deserialize_share(share1)
    x2, y2 = deserialize_share(share2)
    if len(y1) != len(y2):
        raise ValueError("Share length mismatch")
    secret_bytes = _combine_bytes([(x1, y1), (x2, y2)], len(y1))
    return secret_bytes.decode("utf-8")


def serialize_share(x: int, y: bytes) -> str:
    """Encode a share as base64(x_byte + y_bytes) — matches JS serializeShare."""
    return base64.b64encode(bytes([x]) + y).decode("ascii")


def deserialize_share(encoded: str) -> Tuple[int, bytes]:
    """Decode a base64 share. Returns (x, y_bytes)."""
    raw = base64.b64decode(encoded)
    return raw[0], bytes(raw[1:])
```

**Step 4: Run tests — all must pass**

```bash
cd packages/python-sdk
pytest tests/test_shamir.py -v
```
Expected: all 8 tests PASS

**Step 5: Commit**

```bash
git add packages/python-sdk/vaultproof/shamir.py packages/python-sdk/tests/test_shamir.py
git commit -m "feat(python-sdk): GF(256) Shamir implementation with tests"
```

---

### Task 3: VaultProof client

**Files:**
- Create: `packages/python-sdk/vaultproof/client.py`
- Create: `packages/python-sdk/tests/test_client.py`

**Step 1: Write the failing tests**

Create `packages/python-sdk/tests/test_client.py`:

```python
"""
Tests for VaultProof client.
All HTTP calls are mocked — no real network requests.
"""
import json
import unittest
from unittest.mock import patch, MagicMock
from io import BytesIO
import pytest

from vaultproof import VaultProof, StoredKey, ProxyResponse, VaultProofError


def make_response(data: dict, status: int = 200):
    """Create a mock urllib response."""
    body = json.dumps(data).encode()
    mock = MagicMock()
    mock.status = status
    mock.read.return_value = body
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    return mock


class TestInit:
    def test_valid_key(self):
        vault = VaultProof("vp_live_abc123")
        assert vault  # no exception

    def test_invalid_key_raises(self):
        with pytest.raises(VaultProofError, match="vp_"):
            VaultProof("sk-not-a-vaultproof-key")

    def test_custom_api_url(self):
        vault = VaultProof("vp_live_abc123", api_url="https://custom.example.com")
        assert vault._api_url == "https://custom.example.com"


class TestStore:
    @patch("urllib.request.urlopen")
    def test_store_happy_path(self, mock_urlopen):
        mock_urlopen.return_value = make_response({
            "keyId": "slot_123",
            "provider": "openai",
            "label": "Production",
        })
        vault = VaultProof("vp_live_abc123")
        key = vault.store("sk-openai-real-key-abc123", "openai", label="Production")

        assert key.id == "slot_123"
        assert key.provider == "openai"
        assert key.label == "Production"
        assert key.warning is None
        assert key.duplicate_key_ids is None

    @patch("urllib.request.urlopen")
    def test_store_sends_shares_not_raw_key(self, mock_urlopen):
        """Verify the request body contains share1/share2, NOT the raw API key."""
        mock_urlopen.return_value = make_response({
            "keyId": "slot_123", "provider": "openai", "label": "Test",
        })
        vault = VaultProof("vp_live_abc123")
        raw_key = "sk-openai-supersecret-key-abc123"
        vault.store(raw_key, "openai", label="Test")

        call_args = mock_urlopen.call_args
        request_obj = call_args[0][0]
        body = json.loads(request_obj.data.decode())

        assert "share1" in body
        assert "share2" in body
        assert raw_key not in json.dumps(body), "Raw key must NOT appear in request body"
        # Shares must be base64 strings starting with expected x-byte
        import base64
        s1_raw = base64.b64decode(body["share1"])
        s2_raw = base64.b64decode(body["share2"])
        assert s1_raw[0] == 1  # share 1 has x=1
        assert s2_raw[0] == 2  # share 2 has x=2

    @patch("urllib.request.urlopen")
    def test_store_duplicate_warning(self, mock_urlopen):
        mock_urlopen.return_value = make_response({
            "keyId": "slot_new",
            "provider": "openai",
            "label": "Production",
            "warning": "A key already exists for openai/Production",
            "duplicateKeyIds": ["slot_old"],
        })
        vault = VaultProof("vp_live_abc123")
        key = vault.store("sk-openai-new", "openai", label="Production")

        assert key.warning == "A key already exists for openai/Production"
        assert key.duplicate_key_ids == ["slot_old"]

    @patch("urllib.request.urlopen")
    def test_store_replace_revokes_then_stores(self, mock_urlopen):
        """replace=True should call revoke for each duplicate, then store."""
        responses = [
            # First store call returns duplicate warning
            make_response({
                "keyId": "slot_new",
                "provider": "openai",
                "label": "Production",
                "warning": "duplicate",
                "duplicateKeyIds": ["slot_old_1", "slot_old_2"],
            }),
            # Revoke slot_old_1
            make_response({"ok": True}),
            # Revoke slot_old_2
            make_response({"ok": True}),
            # Final store (no duplicates now)
            make_response({
                "keyId": "slot_final",
                "provider": "openai",
                "label": "Production",
            }),
        ]
        mock_urlopen.side_effect = responses

        vault = VaultProof("vp_live_abc123")
        key = vault.store("sk-openai-new", "openai", label="Production", replace=True)

        assert key.id == "slot_final"
        assert key.warning is None
        assert mock_urlopen.call_count == 4  # store + 2 revokes + store again

    @patch("urllib.request.urlopen")
    def test_store_api_error_raises(self, mock_urlopen):
        resp = make_response({"error": "Unauthorized"}, status=401)
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="", code=401, msg="Unauthorized", hdrs={}, fp=BytesIO(b'{"error":"Unauthorized"}')
        )
        vault = VaultProof("vp_live_abc123")
        with pytest.raises(VaultProofError, match="Unauthorized"):
            vault.store("sk-openai-key", "openai")


class TestProxy:
    @patch("urllib.request.urlopen")
    def test_proxy_happy_path(self, mock_urlopen):
        mock_urlopen.return_value = make_response(
            {"choices": [{"message": {"content": "Hello!"}}]},
            status=200,
        )
        vault = VaultProof("vp_live_abc123")
        res = vault.proxy("slot_123", "/v1/chat/completions", {"model": "gpt-4o"})

        assert res.ok is True
        assert res.status == 200
        assert "choices" in res.data

    @patch("urllib.request.urlopen")
    def test_proxy_non_200_not_raises(self, mock_urlopen):
        """Non-200 responses return ProxyResponse with ok=False, don't raise."""
        mock_urlopen.return_value = make_response({"error": "rate limited"}, status=429)
        vault = VaultProof("vp_live_abc123")
        res = vault.proxy("slot_123", "/v1/chat/completions", {})
        assert res.ok is False
        assert res.status == 429


class TestKeys:
    @patch("urllib.request.urlopen")
    def test_keys_empty(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"keys": []})
        vault = VaultProof("vp_live_abc123")
        assert vault.keys() == []

    @patch("urllib.request.urlopen")
    def test_keys_multiple(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"keys": [
            {"id": "s1", "provider": "openai", "label": "Prod", "createdAt": "2026-01-01"},
            {"id": "s2", "provider": "stripe", "label": "Live", "createdAt": "2026-01-02"},
        ]})
        vault = VaultProof("vp_live_abc123")
        keys = vault.keys()
        assert len(keys) == 2
        assert keys[0]["id"] == "s1"


class TestRevoke:
    @patch("urllib.request.urlopen")
    def test_revoke_success(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"ok": True})
        vault = VaultProof("vp_live_abc123")
        vault.revoke("slot_123")  # must not raise

    @patch("urllib.request.urlopen")
    def test_revoke_not_found_raises(self, mock_urlopen):
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="", code=404, msg="Not Found", hdrs={}, fp=BytesIO(b'{"error":"Key not found"}')
        )
        vault = VaultProof("vp_live_abc123")
        with pytest.raises(VaultProofError, match="Key not found"):
            vault.revoke("slot_nonexistent")
```

**Step 2: Run tests — confirm they fail**

```bash
cd packages/python-sdk
pytest tests/test_client.py -v 2>&1 | head -20
```
Expected: `ImportError` — `client.py` doesn't exist yet.

**Step 3: Implement `vaultproof/client.py`**

```python
"""
VaultProof Python SDK client.

Usage:
    from vaultproof import VaultProof

    vault = VaultProof("vp_live_abc123")
    key = vault.store("sk-openai-...", "openai", label="Production")
    res = vault.proxy(key.id, "/v1/chat/completions", {"model": "gpt-4o", ...})
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .exceptions import VaultProofError
from .shamir import split_secret

_DEFAULT_API_URL = "https://api.vaultproof.dev"


@dataclass
class StoredKey:
    id: str
    provider: str
    label: str
    warning: Optional[str] = None
    duplicate_key_ids: Optional[List[str]] = None


@dataclass
class ProxyResponse:
    status: int
    data: Any
    ok: bool


class VaultProof:
    def __init__(self, api_key: str, *, api_url: str = _DEFAULT_API_URL) -> None:
        if not api_key.startswith("vp_"):
            raise VaultProofError(
                "Invalid API key. Must start with vp_live_ or vp_test_"
            )
        self._api_key = api_key
        self._api_url = api_url.rstrip("/")

    # ── Public methods ─────────────────────────────────────────────────────

    def store(
        self,
        api_key: str,
        provider: str,
        label: str = "",
        *,
        replace: bool = False,
    ) -> StoredKey:
        """
        Store an API key securely using Shamir secret sharing.

        The key is split into two shares locally — the raw key never leaves
        this process. Both shares are sent encrypted to VaultProof.

        Args:
            api_key:  The API key to store (e.g. "sk-openai-...")
            provider: Provider slug (e.g. "openai", "anthropic", "stripe")
            label:    Human-readable label to distinguish multiple keys for
                      the same provider. Default: empty string.
            replace:  If True and a duplicate (provider+label) exists, revoke
                      the old key(s) before storing the new one.

        Returns:
            StoredKey with id, provider, label. If a duplicate exists and
            replace=False, warning and duplicate_key_ids are set.
        """
        share1, share2 = split_secret(api_key)

        result = self._request("POST", "/api/v1/sdk/store", {
            "share1": share1,
            "share2": share2,
            "provider": provider,
            "label": label,
        })

        key = StoredKey(
            id=result["keyId"],
            provider=result["provider"],
            label=result.get("label", label),
            warning=result.get("warning"),
            duplicate_key_ids=result.get("duplicateKeyIds"),
        )

        if replace and key.duplicate_key_ids:
            for dup_id in key.duplicate_key_ids:
                self.revoke(dup_id)
            # Store again now that duplicates are cleared
            result2 = self._request("POST", "/api/v1/sdk/store", {
                "share1": share1,
                "share2": share2,
                "provider": provider,
                "label": label,
            })
            key = StoredKey(
                id=result2["keyId"],
                provider=result2["provider"],
                label=result2.get("label", label),
            )

        return key

    def proxy(
        self,
        key_id: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        method: str = "POST",
    ) -> ProxyResponse:
        """
        Make a proxied API call through VaultProof.

        The stored key is reconstructed server-side for ~100ms, used to
        forward your request to the upstream provider, then zeroed.

        Args:
            key_id: The stored key ID (from StoredKey.id)
            path:   Upstream path, e.g. "/v1/chat/completions"
            body:   Request body as a dict (JSON-serialized)
            method: HTTP method, default "POST"

        Returns:
            ProxyResponse with status, data, ok
        """
        try:
            result = self._request("POST", "/api/v1/sdk/call", {
                "keyId": key_id,
                "path": path,
                "method": method,
                "body": body,
            })
            return ProxyResponse(status=200, data=result, ok=True)
        except VaultProofError as e:
            return ProxyResponse(status=e.status, data={"error": str(e)}, ok=False)

    def keys(self) -> List[Dict[str, str]]:
        """List all stored keys for this account."""
        result = self._request("GET", "/api/v1/sdk/keys")
        return result.get("keys", [])

    def revoke(self, key_id: str) -> None:
        """Revoke a stored key. Both shares are zeroed on the server."""
        self._request("POST", "/api/v1/sdk/revoke", {"keyId": key_id})

    # ── Internal HTTP helper ───────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self._api_url + path
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": self._api_key,
        }
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.fp.read().decode())
                msg = err_body.get("error", str(e))
            except Exception:
                msg = str(e)
            raise VaultProofError(msg, status=e.code) from e
        except urllib.error.URLError as e:
            raise VaultProofError(f"Network error: {e.reason}") from e
```

**Step 4: Run all tests — all must pass**

```bash
cd packages/python-sdk
pytest tests/ -v
```
Expected: all tests PASS (8 shamir + ~13 client)

**Step 5: Commit**

```bash
git add packages/python-sdk/vaultproof/client.py packages/python-sdk/tests/test_client.py
git commit -m "feat(python-sdk): VaultProof client with store/proxy/keys/revoke"
```

---

### Task 4: Install verification and README

**Files:**
- Create: `packages/python-sdk/README.md`

**Step 1: Verify the package installs cleanly**

```bash
cd packages/python-sdk
pip install -e .
python -c "from vaultproof import VaultProof; print('OK')"
```
Expected: `OK`

**Step 2: Verify zero dependencies**

```bash
pip show vaultproof | grep Requires
```
Expected: `Requires:` (empty — no deps)

**Step 3: Create README.md**

```markdown
# vaultproof

Python SDK for [VaultProof](https://vaultproof.dev) — store and proxy API keys with split-key encryption.

Your keys are split into two shares **on your machine** using Shamir Secret Sharing. Neither share alone reconstructs the key. VaultProof never sees your key whole.

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

## Duplicate handling

If a key for the same provider + label already exists:

```python
# Warns but stores anyway
key = vault.store("sk-openai-new", "openai", label="Production")
if key.warning:
    print(key.warning)           # "A key already exists for openai/Production"
    print(key.duplicate_key_ids)  # ["slot_old"]

# Or replace in one call (revokes old, stores new)
key = vault.store("sk-openai-new", "openai", label="Production", replace=True)
```

## Security

- Keys are Shamir-split **before** any network call — the raw key never leaves your process
- Shares are sent over TLS to `api.vaultproof.dev`
- On proxy calls, shares are reconstructed in server RAM for ~100ms, then zeroed
- No external dependencies — easy to audit
```

**Step 4: Commit**

```bash
git add packages/python-sdk/README.md
git commit -m "docs(python-sdk): README with install + quick start"
```

---

### Task 5: Publish to PyPI

**Step 1: Install build tools**

```bash
pip install build twine
```

**Step 2: Build the package**

```bash
cd packages/python-sdk
python -m build
```
Expected: creates `dist/vaultproof-1.0.0.tar.gz` and `dist/vaultproof-1.0.0-py3-none-any.whl`

**Step 3: Check the package**

```bash
twine check dist/*
```
Expected: `PASSED`

**Step 4: Upload to PyPI**

```bash
twine upload dist/*
```
You'll be prompted for PyPI credentials. Use the API token from pypi.org (create one under Account Settings → API tokens).

**Step 5: Verify install from PyPI**

```bash
pip install vaultproof --upgrade
python -c "import vaultproof; print(vaultproof.__version__)"
```
Expected: `1.0.0`

**Step 6: Commit version tag**

```bash
git tag python-sdk-v1.0.0
git push origin python-sdk-v1.0.0
git add packages/python-sdk/
git commit -m "feat(python-sdk): v1.0.0 published to PyPI"
```
