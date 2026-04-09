"""VaultProof Python SDK client."""
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
            raise VaultProofError("Invalid API key. Must start with vp_live_ or vp_test_")
        self._api_key = api_key
        self._api_url = api_url.rstrip("/")

    def store(self, api_key: str, provider: str, label: str = "", *, replace: bool = False) -> StoredKey:
        """Shamir-split api_key locally and store shares on VaultProof."""
        share1, share2 = split_secret(api_key)
        result = self._request("POST", "/api/v1/sdk/store", {
            "share1": share1, "share2": share2, "provider": provider, "label": label,
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
            result2 = self._request("POST", "/api/v1/sdk/store", {
                "share1": share1, "share2": share2, "provider": provider, "label": label,
            })
            key = StoredKey(
                id=result2["keyId"],
                provider=result2["provider"],
                label=result2.get("label", label),
            )
        return key

    def proxy(self, key_id: str, path: str, body: Optional[Dict[str, Any]] = None, method: str = "POST") -> ProxyResponse:
        """Make a proxied API call through VaultProof."""
        try:
            result, status = self._request_with_status("POST", "/api/v1/sdk/call", {
                "keyId": key_id, "path": path, "method": method, "body": body,
            })
            ok = 200 <= status < 300
            return ProxyResponse(status=status, data=result, ok=ok)
        except VaultProofError as e:
            return ProxyResponse(status=e.status, data={"error": str(e)}, ok=False)

    def keys(self) -> List[Dict[str, str]]:
        """List all stored keys."""
        return self._request("GET", "/api/v1/sdk/keys").get("keys", [])

    def revoke(self, key_id: str) -> None:
        """Revoke a stored key."""
        self._request("POST", "/api/v1/sdk/revoke", {"keyId": key_id})

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        data, _ = self._request_with_status(method, path, body)
        return data

    def _request_with_status(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        url = self._api_url + path
        headers = {"Content-Type": "application/json", "X-API-Key": self._api_key}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode()), resp.status
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.fp.read().decode()).get("error", str(e))
            except Exception:
                msg = str(e)
            raise VaultProofError(msg, status=e.code) from e
        except urllib.error.URLError as e:
            raise VaultProofError(f"Network error: {e.reason}") from e
