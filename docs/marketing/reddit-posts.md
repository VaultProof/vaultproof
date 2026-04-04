# Reddit Posts for VaultProof

Six posts using the Reframing tactic: lead with the problem, not the product.

---

## 1. r/ClaudeAI

**Title:** I built an MCP server so Claude can use my APIs without seeing my keys

**Body:**

I kept running into the same problem: I want Claude to call external APIs on my behalf, but that means pasting API keys into the conversation. Even with Projects or system prompts, the key is right there in the context window. Felt wrong.

So I built a small MCP server that acts as a proxy. You store your API key once, and when Claude needs to make a request, it goes through the proxy. The proxy injects the key server-side. Claude never sees the actual secret -- it just gets the response back.

The setup is one line in your MCP config:

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

After that you get four tools: `store-key`, `list-keys`, `get-usage`, and `proxy-request`. Auth is OAuth 2.1 with PKCE, so no tokens floating around either.

The key thing (no pun intended) is that `proxy-request` makes the API call from the server side. Claude tells the proxy "call this endpoint with this key name" and the proxy handles the rest. The secret never enters the conversation.

It also supports origin/domain locking if you want to restrict which domains can use a particular key.

Free to use: [vaultproof.dev](https://vaultproof.dev)

How are you all handling API key security with Claude right now? Just pasting keys in and hoping for the best, or have you found a better workflow?

---

## 2. r/ChatGPTCoding

**Title:** How I give AI agents API access without exposing my secrets

**Body:**

If you're using AI agents to call external APIs -- whether it's ChatGPT, Claude, or anything else -- you've probably had that uncomfortable moment where you paste an API key directly into the chat or config. The agent needs the key to make the call, but now your secret is sitting in a context window, a log, or some plugin's memory.

I built a proxy that solves this. Here's the concept:

1. You store your API key in a vault. Before storage, the key gets split into pieces -- no single piece is useful on its own.
2. When your agent needs to call an API, it makes a request to the proxy instead of the real endpoint.
3. The proxy reassembles the key, injects it into the request header, forwards it to the real API, and returns the response.
4. The agent never sees the key. It just gets the data.

It works with anything that can make an HTTP call. Doesn't matter if you're using ChatGPT plugins, Claude MCP, LangChain, or a local script. If it can hit a URL, it can use the proxy.

There's also an MCP server if you're in the Claude ecosystem, but the proxy endpoint works independently of any specific LLM.

Other features:
- OAuth 2.1 + PKCE authentication
- Origin/domain locking (restrict which apps can use a key)
- Usage tracking per key

Free at [vaultproof.dev](https://vaultproof.dev).

What's your current approach for giving agents access to APIs that need auth? Curious if anyone's rolled their own solution.

---

## 3. r/LocalLLaMA

**Title:** Secret management for AI agents -- works with any LLM, not just Claude

**Body:**

A lot of the secret management tooling in the AI agent space is locked to specific platforms (Claude MCP, OpenAI plugins, etc.). If you're running local models and building your own agent pipelines, you're mostly on your own for handling API keys securely.

I built a proxy-based approach that works with anything that can make HTTP requests:

- Store API keys in the vault. Keys are split before storage so no single component has the full secret.
- When your agent needs to hit an external API, it calls the proxy URL instead. The proxy reconstructs the key, injects it server-side, and forwards the request.
- Your agent code (and your local LLM) never touches the raw key.

It's just HTTP. If your local model can call a tool that makes a web request, it works. No SDK, no plugin system, no vendor lock-in.

There's also an MCP server at `mcp.vaultproof.dev` for people in that ecosystem, but the proxy itself is protocol-agnostic.

Architecture if you're curious:
- Cloudflare Workers for the proxy (edge, low latency)
- Supabase for storage
- Split-key model so the database alone can't reconstruct your secret
- OAuth 2.1 + PKCE for auth
- Domain locking to restrict key usage to specific origins

Free to use: [vaultproof.dev](https://vaultproof.dev)

How are you all handling secrets in your local LLM agent setups? Env vars and hoping for the best? I'd love to hear what approaches people have tried.

---

## 4. r/MCP

**Title:** VaultProof MCP Server -- secure API key proxy for AI agents

**Body:**

Hey all, sharing an MCP server I built for managing API keys securely in agent workflows.

**The problem:** MCP tools often need API keys to call external services, but passing keys through the LLM context means the model (and anything in the conversation history) can see your secrets.

**The approach:** A proxy that injects keys server-side. The LLM never sees the raw secret.

**Config (one line):**

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

**Tools:**

| Tool | What it does |
|------|-------------|
| `store-key` | Store an API key. The key is split before storage -- no single piece is the full secret. |
| `list-keys` | List your stored keys (names/metadata only, never the raw key). |
| `get-usage` | See usage stats per key. |
| `proxy-request` | Make an API call through the proxy. You specify the key name and the endpoint. The proxy injects the key and forwards the request. The agent gets the response, never the key. |

**Auth flow:**
- OAuth 2.1 with PKCE
- No static tokens, no bearer keys in MCP config
- Origin/domain locking available per key

**Stack:** Cloudflare Workers + Supabase

Free to use: [vaultproof.dev](https://vaultproof.dev)

Would love feedback on the tool design. A few open questions I'm thinking about:
- Should `proxy-request` support batch calls (multiple endpoints in one tool invocation)?
- Is there a better pattern for letting the agent specify which header to inject the key into?
- Any MCP conventions I'm missing for error handling?

What does your current key management setup look like for MCP servers?

---

## 5. r/selfhosted

**Title:** Open proxy for API keys -- AI agents never see the secret

**Body:**

I've been building AI agent workflows that call external APIs, and the key management story is terrible. Most setups just have the agent hold the raw API key in memory or config. If you're self-hosting agents, that means keys are floating around in logs, context windows, and tool configs.

I built a proxy-based vault that keeps secrets out of the agent entirely:

**How it works:**

1. You store an API key. Before it hits the database, it gets split into multiple pieces. No single piece can reconstruct the key.
2. The pieces are stored across different layers (database + edge worker).
3. When an agent needs to use the key, it calls the proxy with just the key *name* and the target endpoint.
4. The proxy reassembles the key at the edge (Cloudflare Workers), injects it into the outgoing request, and returns the API response.
5. The key is never sent back to the client. The agent only sees the response data.

**Additional controls:**
- Origin/domain locking -- restrict which domains can trigger a particular key
- Usage tracking per key
- OAuth 2.1 + PKCE auth (no static tokens)

Currently this runs on Cloudflare Workers + Supabase. Free to use at [vaultproof.dev](https://vaultproof.dev).

I know this crowd's first question: **is there a self-hostable version?** Not yet, but I'm seriously considering it. The architecture is Workers + Supabase, so a self-hosted version could run on something like Miniflare + Postgres.

Would a self-hostable version be useful to you? And if so, would you prefer a Docker image, a bare Workers script you deploy to your own CF account, or something else entirely?

---

## 6. r/cybersecurity

**Title:** Novel approach to secret management for AI agent workflows

**Body:**

Wanted to share something I've been working on and get feedback from people who think about this stuff professionally.

**The threat model:**

AI agents (LLM-based) increasingly need to call external APIs. The standard pattern is: give the agent the API key, let it make the call. The problem is that the key now exists in the LLM's context window, in conversation logs, potentially in training data, and in any tool/plugin that has access to the conversation state. This is a broad, hard-to-control attack surface.

**The approach:**

Instead of giving the agent the key, I built a proxy. The agent calls the proxy with a key *name* and a target endpoint. The proxy resolves the key, injects it server-side, and returns the response. The agent never has the raw secret.

**Key storage uses Shamir's Secret Sharing:**

When a key is stored, it's split into shares using Shamir's scheme over GF(256). Shares are distributed across storage layers (Supabase for persistence, Cloudflare Workers KV for the edge component). Reconstruction only happens in-memory at the edge worker during a proxy request, and the reassembled key is never persisted or returned to the client.

**Auth:**
- OAuth 2.1 with PKCE for the MCP interface
- Per-key origin/domain locking (the proxy checks the request origin against an allowlist before reconstructing)
- No static bearer tokens

**What the agent sees:**
- A tool called `proxy-request` that accepts a key name, target URL, method, and headers/body
- The API response

**What the agent does NOT see:**
- The raw API key
- The Shamir shares
- Any key material

**Stack:** Cloudflare Workers (reconstruction + proxy at edge), Supabase (share persistence), MCP protocol for LLM integration.

Live at [vaultproof.dev](https://vaultproof.dev).

**Where I'd love feedback:**

- Are there attack vectors I'm not considering? The obvious ones I've thought about: compromised Worker runtime, Supabase breach (only gets partial shares), MCP protocol injection to trick the proxy into leaking key material via crafted URLs.
- Is Shamir overkill here vs. envelope encryption with a KMS? My reasoning is that it avoids having a single decryption key that could be exfiltrated, but I'd love to hear counterarguments.
- Any thoughts on the origin-locking approach? It's HTTP Origin/Referer-based, which I know is spoofable outside a browser context. Open to better ideas for restricting which clients can trigger reconstruction.

What does your org currently do for secret management in AI/agent workflows, if anything?
