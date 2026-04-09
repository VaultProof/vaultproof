"""Tests for VaultProof client. All HTTP calls mocked."""
import json
import pytest
from io import BytesIO
from unittest.mock import patch, MagicMock
from vaultproof import VaultProof, StoredKey, ProxyResponse, VaultProofError


def make_response(data: dict, status: int = 200):
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
        assert vault

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
            "keyId": "slot_123", "provider": "openai", "label": "Production",
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
        mock_urlopen.return_value = make_response({
            "keyId": "slot_123", "provider": "openai", "label": "Test",
        })
        vault = VaultProof("vp_live_abc123")
        raw_key = "sk-openai-supersecret-key-abc123"
        vault.store(raw_key, "openai", label="Test")

        request_obj = mock_urlopen.call_args[0][0]
        body = json.loads(request_obj.data.decode())
        assert "share1" in body
        assert "share2" in body
        assert raw_key not in json.dumps(body), "Raw key must NOT appear in request body"
        import base64
        assert base64.b64decode(body["share1"])[0] == 1
        assert base64.b64decode(body["share2"])[0] == 2

    @patch("urllib.request.urlopen")
    def test_store_duplicate_warning(self, mock_urlopen):
        mock_urlopen.return_value = make_response({
            "keyId": "slot_new", "provider": "openai", "label": "Production",
            "warning": "A key already exists for openai/Production",
            "duplicateKeyIds": ["slot_old"],
        })
        vault = VaultProof("vp_live_abc123")
        key = vault.store("sk-openai-new", "openai", label="Production")
        assert key.warning == "A key already exists for openai/Production"
        assert key.duplicate_key_ids == ["slot_old"]

    @patch("urllib.request.urlopen")
    def test_store_replace_revokes_then_stores(self, mock_urlopen):
        from urllib.error import HTTPError
        responses = [
            make_response({
                "keyId": "slot_new", "provider": "openai", "label": "Production",
                "warning": "duplicate", "duplicateKeyIds": ["slot_old_1", "slot_old_2"],
            }),
            make_response({"ok": True}),
            make_response({"ok": True}),
            make_response({"keyId": "slot_final", "provider": "openai", "label": "Production"}),
        ]
        mock_urlopen.side_effect = responses
        vault = VaultProof("vp_live_abc123")
        key = vault.store("sk-openai-new", "openai", label="Production", replace=True)
        assert key.id == "slot_final"
        assert key.warning is None
        assert mock_urlopen.call_count == 4

    @patch("urllib.request.urlopen")
    def test_store_api_error_raises(self, mock_urlopen):
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="", code=401, msg="Unauthorized", hdrs={},
            fp=BytesIO(b'{"error":"Unauthorized"}')
        )
        vault = VaultProof("vp_live_abc123")
        with pytest.raises(VaultProofError, match="Unauthorized"):
            vault.store("sk-openai-key", "openai")


class TestProxy:
    @patch("urllib.request.urlopen")
    def test_proxy_happy_path(self, mock_urlopen):
        mock_urlopen.return_value = make_response(
            {"choices": [{"message": {"content": "Hello!"}}]}, status=200
        )
        vault = VaultProof("vp_live_abc123")
        res = vault.proxy("slot_123", "/v1/chat/completions", {"model": "gpt-4o"})
        assert res.ok is True
        assert res.status == 200
        assert "choices" in res.data

    @patch("urllib.request.urlopen")
    def test_proxy_non_200_returns_not_raises(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"error": "rate limited"}, status=429)
        vault = VaultProof("vp_live_abc123")
        res = vault.proxy("slot_123", "/v1/chat/completions", {})
        assert res.ok is False
        assert res.status == 429


class TestKeys:
    @patch("urllib.request.urlopen")
    def test_keys_empty(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"keys": []})
        assert VaultProof("vp_live_abc123").keys() == []

    @patch("urllib.request.urlopen")
    def test_keys_multiple(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"keys": [
            {"id": "s1", "provider": "openai", "label": "Prod", "createdAt": "2026-01-01"},
            {"id": "s2", "provider": "stripe", "label": "Live", "createdAt": "2026-01-02"},
        ]})
        keys = VaultProof("vp_live_abc123").keys()
        assert len(keys) == 2
        assert keys[0]["id"] == "s1"


class TestRevoke:
    @patch("urllib.request.urlopen")
    def test_revoke_success(self, mock_urlopen):
        mock_urlopen.return_value = make_response({"ok": True})
        VaultProof("vp_live_abc123").revoke("slot_123")  # must not raise

    @patch("urllib.request.urlopen")
    def test_revoke_not_found_raises(self, mock_urlopen):
        from urllib.error import HTTPError
        mock_urlopen.side_effect = HTTPError(
            url="", code=404, msg="Not Found", hdrs={},
            fp=BytesIO(b'{"error":"Key not found"}')
        )
        with pytest.raises(VaultProofError, match="Key not found"):
            VaultProof("vp_live_abc123").revoke("slot_nonexistent")
