"""
GF(256) Shamir Secret Sharing — pure Python, zero deps.
Wire format matches packages/shamir/src/index.ts exactly:
  serialized_share = base64( bytes([x]) + y_bytes )
Irreducible polynomial: x^8 + x^4 + x^3 + x + 1 (0x11b).
"""
from __future__ import annotations
import base64
import os
from typing import List, Tuple

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

def _split_bytes(secret: bytes) -> Tuple[bytes, bytes]:
    y1 = bytearray(len(secret))
    y2 = bytearray(len(secret))
    rand = os.urandom(len(secret))
    for i, s in enumerate(secret):
        coeff1 = rand[i]
        y1[i] = _gf_add(s, _gf_mul(coeff1, 1))
        y2[i] = _gf_add(s, _gf_mul(coeff1, 2))
    return bytes(y1), bytes(y2)

def _combine_bytes(points: List[Tuple[int, bytes]], length: int) -> bytes:
    secret = bytearray(length)
    for byte_idx in range(length):
        value = 0
        for i, (xi, yi) in enumerate(points):
            basis = 1
            for j, (xj, _) in enumerate(points):
                if i == j:
                    continue
                basis = _gf_mul(basis, _gf_div(xj, _gf_add(xi, xj)))
            value = _gf_add(value, _gf_mul(yi[byte_idx], basis))
        secret[byte_idx] = value
    return bytes(secret)

def split_secret(secret: str) -> Tuple[str, str]:
    """Shamir-split a secret string into two base64-encoded shares."""
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
    """Encode share as base64(x_byte + y_bytes) — matches JS serializeShare."""
    return base64.b64encode(bytes([x]) + y).decode("ascii")

def deserialize_share(encoded: str) -> Tuple[int, bytes]:
    """Decode a base64 share. Returns (x, y_bytes)."""
    raw = base64.b64decode(encoded)
    return raw[0], bytes(raw[1:])
