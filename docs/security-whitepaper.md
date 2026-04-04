# VaultProof Security Whitepaper

**The problem with API key vaults — and how VaultProof solves it.**

---

## The Problem

Every API key manager faces the same fundamental problem: to be useful, it has to store your key. And if it stores your key, it can see your key.

This creates a single point of failure. If the vault provider is hacked, your keys are exposed. If a rogue employee queries the database, your keys are exposed. If a server is misconfigured and logs requests, your keys are exposed.

Most "secure" key vaults encrypt keys at rest — but they hold the encryption key too. Encrypting data with a key you also control isn't security, it's just an extra step for an attacker.

VaultProof is designed so that we never hold your complete key. This isn't a policy — it's enforced by the architecture.

---

## The Architecture

**VaultProof stores your API key in two encrypted pieces. The full key is only briefly reassembled during proxy calls, then immediately discarded.**

This design means that even if:
- VaultProof's database is fully compromised
- VaultProof's servers are under an attacker's control
- A VaultProof employee queries every table in the database

...the stored data is cryptographically protected without the piece that only your device holds.

---

## How It Works

### Storing a key

When you paste an API key into VaultProof, two things happen — entirely in your browser or CLI, before any network request is made:

1. Your key is **split into two pieces** using a cryptographic splitting algorithm. Neither piece alone reveals anything about the original key. The split happens on your device.

2. **Piece 1** is encrypted and sent to VaultProof's vault.
   **Piece 2** stays on your device. It is never transmitted to our servers.

The vault receives an encrypted half of a key. That's all.

### Using a key

When you make an API call through VaultProof:

1. Your device sends Piece 2 to the vault, along with a zero-knowledge proof that you are authorized to access Piece 1.
2. The vault combines both pieces to reconstruct the full key — briefly in memory.
3. The reconstructed key is used to make the API call.
4. The key is immediately zeroed from memory. It is never written to disk, never logged, never stored.

The key exists whole for the duration of one API call. Then it's gone.

### Zero-knowledge authorization

To retrieve Piece 1, your device doesn't just send a password or token. It sends a cryptographic proof — a mathematical statement that proves you are authorized *without revealing the secret that proves it*.

This means: even if someone intercepts the authorization request, they cannot replay it to gain access. Each proof is valid for exactly one use.

---

## Threat Model

### What an attacker needs to steal your key

To reconstruct your API key, an attacker needs **both** of the following:

- **Piece 1** — encrypted, stored in VaultProof's vault
- **Piece 2** — stored only on your device, never transmitted

Compromising VaultProof's servers gives an attacker only Piece 1. It is cryptographically useless without Piece 2. Compromising your device gives an attacker only Piece 2 — useless without Piece 1.

An attacker would need to simultaneously compromise both VaultProof's infrastructure **and** your device. These are two independent systems. A breach of one does not enable a breach of the other.

### What VaultProof can see

| Data | What we store | What we can reconstruct |
|---|---|---|
| Your API key | Encrypted Piece 1 only | Nothing — we don't have Piece 2 |
| Your requests | Request metadata (provider, timestamp, token count) | Not the key used |
| Your authorization | A one-time-use proof | Cannot be replayed |

We can see that you made a request to OpenAI at 3pm and used 500 tokens. We cannot see your OpenAI key.

### What if VaultProof is hacked?

An attacker who fully compromises VaultProof's database and servers would obtain:
- Encrypted Piece 1 for every stored key
- Request metadata (timestamps, providers, usage)
- User account information (email, billing)

They would **not** obtain:
- Any complete API key
- Any plaintext key material
- Piece 2 for any key (it was never sent to us)

Your keys remain safe. You should still rotate them as a precaution, but a VaultProof breach does not expose your keys.

---

## The Open Source Core

The code that implements key splitting and authorization runs on your machine. We have open sourced it so you can verify these claims yourself:

- **Key splitting library** — the algorithm that splits your key into two pieces
- **Authorization circuits** — the zero-knowledge proof logic
- **SDK** — the client code that runs in your application
- **CLI** — the terminal client

The backend that stores Piece 1 is closed source. You don't need to trust it — by design, it never holds enough information to reconstruct your keys.

[View the open source code →](https://github.com/vaultproof/vaultproof)

---

## Independent Audit

The open source core has been reviewed by independent security researchers. The full audit report is available at [vaultproof.dev/security](https://vaultproof.dev/security).

*(Audit in progress — will be updated upon completion.)*

---

## Questions

Security questions and responsible disclosure: security@vaultproof.dev
