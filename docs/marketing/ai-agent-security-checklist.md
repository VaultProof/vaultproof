# Stop Pasting API Keys into ChatGPT: An AI Agent Security Checklist

Every tutorial on building AI agents starts the same way: "Paste your API key here." You drop your OpenAI key into a prompt, your Stripe key into a plugin, your database credentials into a config file that gets committed to Git. It works. It's also reckless.

The problem isn't that AI agents need access to APIs. They do. The problem is that most setups hand the agent the raw secret and hope for the best. That key now lives in logs, in memory, in whatever context window gets cached on a server you don't control. If the agent is compromised, if the provider has a breach, if your prompt gets leaked -- your key is out there. And unlike a password, API keys don't have two-factor auth. Whoever has the key *is* you, as far as that API is concerned.

This checklist is for developers building with AI agents -- whether that's MCP servers, custom tool-calling setups, or agent frameworks. It's the stuff you should think about before shipping, organized by when it matters.

---

## The Checklist

### Before You Start

- [ ] **Inventory every key your agent will touch.** Write them down. If you don't know what keys are in play, you can't secure them. Include third-party APIs, databases, payment processors -- everything.

- [ ] **Separate dev keys from production keys.** Your agent should never touch a production Stripe key during development. Create dedicated dev/test keys for every service. If a service doesn't offer test keys, create a separate account.

- [ ] **Set spend limits and rate caps on every key.** Most API providers let you set monthly spend caps. Do it *before* you hand the key to an agent. An agent in a loop can burn through hundreds of dollars in minutes. This is your seatbelt.

- [ ] **Decide on a scope policy.** Not every agent needs access to every key. Map out which agents need which keys, and plan to enforce that boundary -- not just with good intentions, but with actual access controls.

---

### How You Store Keys

- [ ] **Never hardcode keys in source files.** This includes config files, Dockerfiles, and especially Jupyter notebooks. If it touches Git, assume it's public.

- [ ] **Don't trust `.env` files alone.** `.env` is better than hardcoding, but it's still plaintext on disk. Anyone with access to the machine (or a path traversal bug) can read it. It's a starting point, not a solution.

- [ ] **Use a secret manager that encrypts at rest.** Your keys should be encrypted before they hit storage. Tools like VaultProof split your key into fragments using secret sharing before storing anything -- so even a database breach doesn't expose the raw key. Whatever you use, "plaintext in a database" is not acceptable.

- [ ] **Rotate keys on a schedule.** Set a calendar reminder. Quarterly is a reasonable starting point for most API keys. If a key has been exposed, rotate immediately -- don't wait.

- [ ] **Audit who and what has accessed each key.** If your secret manager doesn't have access logs, find one that does. You need to know when a key was last used and by whom.

---

### How Agents Access Keys

This is where most setups fail. Even if you store keys properly, the moment you inject a raw key into an agent's context, you've lost control of it.

- [ ] **Never pass raw keys to an agent.** The agent should not see, log, or hold the actual secret. If your agent can print the key, your setup is broken.

- [ ] **Use a proxy layer for API calls.** Instead of giving the agent a key, give it a proxy endpoint. The proxy injects the key server-side and forwards the request. The agent makes the call, gets the response, and never touches the secret. VaultProof's `proxy-request` MCP tool works exactly this way -- the agent says "call this API" and the proxy handles authentication behind the scenes.

- [ ] **Scope keys per agent.** If you have three agents, they should each have their own scoped credentials with only the permissions they need. One compromised agent shouldn't give access to everything.

- [ ] **Lock keys to specific origins or domains.** If your agent only runs from one server, restrict the key so it can only be used from that origin. This limits the blast radius if credentials leak. VaultProof supports origin locking out of the box -- you specify which domains can use each key.

- [ ] **Use short-lived tokens when possible.** If the API supports it, generate tokens that expire in hours, not months. OAuth 2.1 flows with PKCE are the gold standard here.

---

### Monitoring

- [ ] **Log every API call made through your agent.** Not just successes -- failures too. Unexpected 401s or 403s can signal that someone is testing stolen credentials.

- [ ] **Set up spend and usage alerts.** Get notified when usage spikes beyond normal patterns. A sudden 10x in API calls at 3am is worth investigating immediately.

- [ ] **Have a revocation plan.** Before something goes wrong, know exactly how to revoke every key your agent uses. Document the steps. Practice it. When a key leaks at 2am, you don't want to be hunting through dashboards.

- [ ] **Review agent logs for key leakage.** Search your logs for patterns that look like API keys. If a key shows up in a log entry, your proxy layer has a hole. Fix it.

---

## Quick Reference

| Risk | Bad Practice | Better Practice |
|---|---|---|
| Key exposure in source | Hardcoded in code or config files | Secret manager with encryption at rest |
| Key visible to agent | Pass raw key in prompt or context | Proxy layer injects key server-side |
| Unlimited blast radius | One key shared across all agents | Scoped, per-agent keys with least privilege |
| No spend control | Uncapped API keys | Spend limits and rate caps on every key |
| Stale credentials | Keys that never rotate | Scheduled rotation (quarterly minimum) |
| Leaked key, slow response | No revocation plan | Documented, practiced revocation runbook |
| Unrestricted origin | Key works from any IP/domain | Origin-locked to specific domains |
| Silent compromise | No monitoring or alerts | Usage logging with anomaly alerts |

---

## Getting Started with VaultProof

If you want to check most of these boxes in about five minutes, here's how to set up VaultProof with Claude (or any MCP-compatible agent):

**1. Sign up at [vaultproof.dev](https://vaultproof.dev)**
Free account. No credit card.

**2. Store your first API key**
Use the dashboard or the MCP `store-key` tool. Your key gets split using secret sharing before storage -- the raw key is never stored whole.

**3. Add the MCP server to your agent config**

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

**4. Ask your agent to make an API call**
Instead of pasting a key, just tell Claude: *"Use my OpenAI key to list my models."* The `proxy-request` tool handles the rest -- the key is injected server-side, and your agent never sees it.

That's it. Your keys are encrypted, split, proxy-injected, and logged. Your agent gets the access it needs without ever holding the secret.

---

*Have questions or want to report a security issue? Reach out at [vaultproof.dev](https://vaultproof.dev).*
