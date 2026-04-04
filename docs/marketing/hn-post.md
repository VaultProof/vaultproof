# Hacker News "Show HN" Post Draft

## Title Options

1. **Show HN: An MCP server that injects API keys server-side so AI agents never see them**  (RECOMMENDED)
2. Show HN: Secret sharing + proxy to keep API keys away from AI agents
3. Show HN: I built a key vault with an MCP server so Claude/GPT can use APIs without seeing secrets

## URL

https://vaultproof.dev

## Top-Level Comment

Post this immediately after submitting:

---

I built VaultProof because I kept pasting API keys into AI agent configs and it bothered me. The agent doesn't need to *know* my Stripe key to call Stripe -- it just needs someone to attach the key to the request. So I built that "someone."

**How it works:**

When you store a key, it gets split into shares using secret sharing before it touches any database. No single store holds the complete key.

When an agent needs to make an API call, it calls the `proxy-request` MCP tool with the URL and payload -- but *without* the key. The proxy reconstructs the key server-side, attaches it to the outgoing request header, and forwards it to the target API. The agent gets the response back. At no point does the agent see or handle the raw key.

You can also lock keys to specific origin domains, so even if someone gets a reference to your stored key, it only works from your approved domains.

**What's live today:**

- MCP server at `mcp.vaultproof.dev` with 4 tools: `store-key`, `list-keys`, `get-usage`, `proxy-request`
- Origin/domain locking per key
- Works with any API that uses header-based auth (Bearer tokens, X-API-Key, custom headers)
- OAuth 2.1 + PKCE for MCP authentication
- Free to use

**Tech stack:**

- Cloudflare Workers (proxy + MCP server)
- Supabase (auth + metadata storage)
- Key shares stored across Workers KV

**MCP config:**

```json
{"mcpServers": {"vaultproof": {"url": "https://mcp.vaultproof.dev/mcp"}}}
```

**Honest limitations:**

- Early stage. Auth code exchange and rate limiting use KV, which doesn't have atomic operations. There are mitigations in place, but proper atomic enforcement needs Durable Objects (on the roadmap).
- The proxy reconstructs the full key in memory during request forwarding. It's ephemeral and never logged, but it does exist briefly in the Worker's execution context.
- I'm one person building this. If you find issues, I want to hear about them.

Would love feedback on the approach, the architecture, or anything that seems off. Especially interested in hearing from folks who are building with MCP and running into the same key management headaches.

---

## Posting Tips

- **Best time:** Tuesday or Wednesday, 8-9am ET
- **Never** ask for upvotes, directly or indirectly
- Respond to every comment, even critical ones -- especially critical ones. HN respects founders who engage honestly.
- Be upfront about limitations. If someone finds a flaw, thank them and explain your plan (or admit you hadn't considered it).
- If asked about the split-key approach: "The key gets split into multiple shares using secret sharing. You need a threshold number of shares to reconstruct it. No single database row or KV entry contains the full key." Keep it plain.
- If asked "why not just use environment variables?": The point is that the *agent* never handles the key. Env vars solve storage, not agent access control.
- If asked about the in-memory reconstruction: Be honest. The key exists briefly in the Worker's memory during proxy. This is a known trade-off vs. never reconstructing at all (which would require the target API to support split credentials, which none do).
- If someone suggests Durable Objects for the KV race conditions: Agree. It's planned. Explain that KV was chosen to ship fast and the race window is small, but atomic enforcement is the right long-term answer.
- Don't oversell. "It reduces key exposure surface for AI agents" is accurate. "Your keys are mathematically impossible to steal" is not.
