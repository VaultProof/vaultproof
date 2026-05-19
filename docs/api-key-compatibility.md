# API Key Compatibility

## Supported Providers

The provider catalog currently includes 89 signatures. These common providers work with VaultProof's header-based proxy out of the box:

| Provider | Proxy Path | Auth Method |
|----------|-----------|-------------|
| OpenAI | `/p/openai/v1/*` | Bearer token |
| Anthropic | `/p/anthropic/*` | x-api-key header |
| Google (Gemini) | `/p/google/*` | x-goog-api-key header |
| MiniMax | `/p/minimax/v1/*` | Bearer token |
| Voyage AI | `/p/voyage/v1/*` | Bearer token |
| Jina AI | `/p/jina/*` | Bearer token |
| AI21 | `/p/ai21/studio/v1/*` | Bearer token |
| AssemblyAI | `/p/assemblyai/*` | Authorization key |
| Together AI | `/p/together/v1/*` | Bearer token |
| Mistral | `/p/mistral/v1/*` | Bearer token |
| Cohere | `/p/cohere/*` | Bearer token |
| Groq | `/p/groq/openai/v1/*` | Bearer token |
| Perplexity | `/p/perplexity/*` | Bearer token |
| Fireworks AI | `/p/fireworks/inference/v1/*` | Bearer token |
| DeepSeek | `/p/deepseek/v1/*` | Bearer token |
| DeepL API Free | `/p/deepl/*` | `Authorization: DeepL-Auth-Key` |
| DeepL API Pro | `/p/deepl-pro/*` | `Authorization: DeepL-Auth-Key` |
| Replicate | `/p/replicate/*` | Bearer token |
| Stripe | `/p/stripe/*` and `/v1/*` | Bearer token |
| GitHub | `/p/github/*` | Bearer token |
| GitLab | `/p/gitlab/api/v4/*` | PRIVATE-TOKEN header |
| LaunchDarkly | `/p/launchdarkly/api/v2/*` | Authorization key |
| Snyk | `/p/snyk/rest/*` | `Authorization: token` |
| PagerDuty | `/p/pagerduty/*` | `Authorization: Token token=` |
| Grafana | `/p/grafana/*` | Bearer token |
| Honeycomb | `/p/honeycomb/*` | X-Honeycomb-Team header |
| Supabase | `/p/supabase/*` | apikey + Bearer |

## Custom/Internal APIs

`npx @vaultproof/init custom` can protect unsupported or internal HTTP APIs when the API uses a single static key in a request header. Add a plaintext key such as `INTERNAL_API_KEY=...` to `.env`, then follow the prompts for the upstream base URL, header name, and header template.

The upstream must be reachable through a public HTTPS fully-qualified domain name. VaultProof intentionally blocks `localhost`, private IP literals, `.internal`, `.local`, Cloudflare internal hostnames, embedded credentials, and custom ports before it uploads the key.

## Vault-only Runtime Secrets

`npx @vaultproof/init secrets add` protects `.env` values that are not outbound HTTP API keys, including `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, OAuth client secrets, and webhook signing secrets.

These values are stored as split shares and rewritten to `vaultproof://NAME` placeholders. Use `npx @vaultproof/init run -- <command>` to inject plaintext into the child process environment when the app starts.

## What Won't Work

### OAuth-based APIs (no static API key)
- **Google Cloud (OAuth)** — uses short-lived OAuth tokens, not static keys
- **Microsoft Azure / Azure OpenAI** — uses Azure AD tokens or managed identity
- **GitHub API** — personal access tokens work, but GitHub Apps use JWT + installation tokens
- **Slack API** — Bot tokens (`xoxb-`) work, but OAuth user tokens rotate
- **Salesforce** — OAuth 2.0 flow, no static key
- **HubSpot (OAuth apps)** — OAuth tokens expire, need refresh flow

### Webhook signing secrets as proxy keys
- **Stripe webhook secrets** (`whsec_`) — these verify incoming webhooks, not outgoing API calls. They do not use the proxy, but can be stored with `npx @vaultproof/init secrets add`.
- **GitHub webhook secrets** — same, used for signature verification on incoming payloads. Store as vault-only secrets, not proxy keys.
- **Twilio auth tokens for webhooks** — signature verification, not request auth.

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

### Non-HTTP protocols as proxy targets
- **Database connection strings** (Postgres, MySQL, MongoDB) — VaultProof proxies HTTP requests only, but can store and inject these with `secrets add` and `run`.
- **SSH keys** — different protocol entirely. Store/inject only if your runtime expects the key in an env var.
- **SMTP credentials** — email protocol, not HTTP.
- **Redis/Memcached auth** — TCP protocol, not HTTP, but Redis URLs can be vault-only runtime secrets.

## Will Work (with caveats)

| Provider | Caveat |
|----------|--------|
| SendGrid | Bearer token works for email API |
| Twilio | If using API key auth (not Account SID) |
| Pinecone | Bearer token |
| Weaviate | Bearer token |
| Hugging Face | Bearer token |
| ElevenLabs | xi-api-key header |
| Stability AI | Bearer token |
| Any REST API with static Bearer/API-key auth | Works through `npx @vaultproof/init custom` if the upstream is public HTTPS |

## Adding New Providers

Any HTTP API that authenticates via a single static key in a header can be added locally with `npx @vaultproof/init custom`. Open an issue or PR if you want the provider added to the shared catalog.
