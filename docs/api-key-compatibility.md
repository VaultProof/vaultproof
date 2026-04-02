# API Key Compatibility

## Supported Providers

These providers work with VaultProof's transparent proxy out of the box:

| Provider | Proxy Path | Auth Method |
|----------|-----------|-------------|
| OpenAI | `/v1/openai/*` | Bearer token |
| Anthropic | `/v1/anthropic/*` | x-api-key header |
| Google (Gemini) | `/v1/google/*` | x-goog-api-key header |
| Together AI | `/v1/together/*` | Bearer token |
| Mistral | `/v1/mistral/*` | Bearer token |
| Cohere | `/v1/cohere/*` | Bearer token |
| Groq | `/v1/groq/*` | Bearer token |
| Perplexity | `/v1/perplexity/*` | Bearer token |
| Fireworks AI | `/v1/fireworks/*` | Bearer token |
| DeepSeek | `/v1/deepseek/*` | Bearer token |
| Replicate | `/v1/replicate/*` | Bearer token |
| Stripe | `/v1/stripe/*` | Bearer token |
| MiniMax | `/v1/minimax/*` | Bearer token |
| Supabase | `/v1/supabase/{projectRef}/*` | apikey + Bearer |

## What Won't Work

### OAuth-based APIs (no static API key)
- **Google Cloud (OAuth)** — uses short-lived OAuth tokens, not static keys
- **Microsoft Azure / Azure OpenAI** — uses Azure AD tokens or managed identity
- **GitHub API** — personal access tokens work, but GitHub Apps use JWT + installation tokens
- **Slack API** — Bot tokens (`xoxb-`) work, but OAuth user tokens rotate
- **Salesforce** — OAuth 2.0 flow, no static key
- **HubSpot (OAuth apps)** — OAuth tokens expire, need refresh flow

### Webhook signing secrets
- **Stripe webhook secrets** (`whsec_`) — these verify incoming webhooks, not outgoing API calls. VaultProof proxies outgoing requests only.
- **GitHub webhook secrets** — same, used for signature verification on incoming payloads
- **Twilio auth tokens for webhooks** — signature verification, not request auth

### Multi-part auth (key + secret pairs)
- **AWS (Access Key + Secret Key + Signature V4)** — AWS uses a signing process that requires both the access key ID and secret key to compute HMAC signatures per-request. VaultProof stores a single key, not key pairs, and doesn't implement SigV4.
- **Twilio (Account SID + Auth Token)** — uses HTTP Basic Auth with two values. Could work if you concatenate as `SID:Token` but not natively supported.
- **SendGrid** — Bearer token works, but some endpoints need additional account-level auth.

### Client-side / browser-only keys
- **Google Maps API keys** — restricted by HTTP referrer, not compatible with server-side proxy
- **Firebase client keys** — designed for client-side use with domain restrictions
- **reCAPTCHA site keys** — client-side only, no API proxy needed

### Keys with IP allowlisting
- Any API key that's locked to specific IP addresses won't work unless VaultProof's edge IPs are allowlisted. Cloudflare Workers use shared IP ranges that change.

### Short-lived / rotating tokens
- **Any OAuth access token** — tokens that expire in minutes/hours need automatic refresh. VaultProof stores static keys.
- **AWS STS temporary credentials** — expire after 1-12 hours
- **GCP service account keys** — the JSON key file works, but the derived access token doesn't

### Non-HTTP protocols
- **Database connection strings** (Postgres, MySQL, MongoDB) — VaultProof proxies HTTP requests only
- **SSH keys** — different protocol entirely
- **SMTP credentials** — email protocol, not HTTP
- **Redis/Memcached auth** — TCP protocol, not HTTP

## Will Work (with caveats)

| Provider | Caveat |
|----------|--------|
| SendGrid | Bearer token works for email API |
| Twilio | If using API key auth (not Account SID) |
| Pinecone | Bearer token |
| Weaviate | Bearer token |
| Hugging Face | Bearer token |
| Eleven Labs | xi-api-key header (would need custom provider config) |
| Stability AI | Bearer token |
| Any REST API with static Bearer/API-key auth | Works if provider is added to config |

## Adding New Providers

Any HTTP API that authenticates via a single static key in a header can be added. Open an issue or PR to add your provider.
