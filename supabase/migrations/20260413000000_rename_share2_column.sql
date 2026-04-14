-- Rename share2_encrypted to share2_b64 to accurately reflect that this column
-- stores raw base64 data (client-side Shamir share), not encrypted ciphertext.
-- share1_encrypted remains correctly named (it IS AES-256-GCM encrypted).
ALTER TABLE public.project_keys RENAME COLUMN share2_encrypted TO share2_b64;
