# Tamper-Evident Audit Logs

VaultProof can attach a cryptographic audit-chain proof to every project proxy access log.

The proof is stored in `project_access_logs.metadata.audit_chain` and is also available through:

```text
GET /api/v1/init/audit/export
GET /api/v1/init/audit/export?project_id=<project_uuid>&days=30&limit=1000
```

Each proof contains:

- `event_hash`: SHA-256 of the canonical audit event.
- `previous_hash`: the previous log's chain hash for that project, or the genesis hash for the first signed event.
- `chain_hash`: SHA-256 of `{ version, previous_hash, event_hash }`.
- `signature`: Ed25519 signature over `vaultproof-audit-chain-v1\n{chain_hash}` when `AUDIT_CHAIN_ED25519_PRIVATE_KEY_B64` is configured.
- `signature_key_id` and `public_key_spki_sha256`: signer identity for compliance evidence.

The canonical event includes timestamp, project ID, key ID, provider, slug, method, upstream path hash, status code, latency, error, and metadata hash. It intentionally hashes the upstream path instead of placing the raw path in the proof payload.

## Enabling Signing

Generate an Ed25519 key pair and store the private key as a Cloudflare Worker secret:

```bash
node -e "const {generateKeyPairSync}=require('node:crypto'); const {privateKey,publicKey}=generateKeyPairSync('ed25519'); console.log('private', privateKey.export({format:'der',type:'pkcs8'}).toString('base64')); console.log('public', publicKey.export({format:'der',type:'spki'}).toString('base64'));"
cd packages/init-worker
npx wrangler secret put AUDIT_CHAIN_ED25519_PRIVATE_KEY_B64
```

Optionally set a stable key identifier in `wrangler.toml`:

```toml
AUDIT_CHAIN_KEY_ID = "prod-2026-05"
```

Without a signing key, VaultProof still writes event and chain hashes, but the log is not externally signed. Enterprise compliance claims should use signed exports.
