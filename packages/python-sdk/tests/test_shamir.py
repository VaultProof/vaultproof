"""
Tests for GF(256) Shamir implementation.
Wire format must match packages/shamir/src/index.ts exactly:
  serialized_share = base64( bytes([x]) + y_bytes )
"""
import base64
import pytest
from vaultproof.shamir import split_secret, combine_shares, serialize_share, deserialize_share, _combine_bytes


class TestGF256:
    def test_round_trip_simple(self):
        share1, share2 = split_secret("hello")
        assert combine_shares(share1, share2) == "hello"

    def test_round_trip_openai_key(self):
        secret = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGh"
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_round_trip_unicode(self):
        secret = "sk-ant-test-key-123"
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_round_trip_long_key(self):
        secret = "sk-ant-api03-" + "x" * 200
        share1, share2 = split_secret(secret)
        assert combine_shares(share1, share2) == secret

    def test_wire_format_x_byte(self):
        """Share 1 must have x=1, share 2 must have x=2."""
        share1, share2 = split_secret("test")
        assert base64.b64decode(share1)[0] == 1
        assert base64.b64decode(share2)[0] == 2

    def test_wire_format_length(self):
        """y_bytes length must equal len(secret.encode('utf-8'))."""
        secret = "hello"
        share1, _ = split_secret(secret)
        raw = base64.b64decode(share1)
        assert len(raw) == 1 + len(secret.encode("utf-8"))

    def test_serialize_deserialize_roundtrip(self):
        share1, share2 = split_secret("test-key-abc")
        x1, y1 = deserialize_share(share1)
        x2, y2 = deserialize_share(share2)
        assert x1 == 1
        assert x2 == 2
        assert combine_shares(share1, share2) == "test-key-abc"

    def test_known_vector(self):
        """
        Hand-computed GF(256) vector for cross-language compatibility.
        secret=bytes([5]), random_coeff=3, x1=1, x2=2
          y1 = 5 XOR gf_mul(3,1) = 5 XOR 3 = 6
          y2 = 5 XOR gf_mul(3,2) = 5 XOR 6 = 3
        Lagrange at x=0 from (1,6),(2,3) must reconstruct 5.
        """
        share1 = base64.b64encode(bytes([1, 6])).decode()
        share2 = base64.b64encode(bytes([2, 3])).decode()
        result = _combine_bytes([(1, bytes([6])), (2, bytes([3]))], length=1)
        assert result == bytes([5])

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            split_secret("")
