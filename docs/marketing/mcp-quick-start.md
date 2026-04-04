# VaultProof MCP Server — 2-Minute Setup

Give Claude secure API access without exposing your keys.

## Step 1: Sign up

Go to [vaultproof.dev](https://vaultproof.dev) and create a free account.

## Step 2: Store a key

After signing in, store an API key (e.g., your OpenAI key). VaultProof splits and encrypts it automatically.

## Step 3: Connect to Claude

### Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

Restart Claude Desktop. You'll be prompted to authorize VaultProof on first use.

### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

## Step 4: Use it

Ask Claude to make an API call:

> "Use VaultProof to call the OpenAI API and list my models"

Claude will use the `proxy-request` tool. Your API key is injected server-side — Claude never sees it.

## Available MCP Tools

| Tool | What it does |
|------|-------------|
| `list-keys` | See your stored keys (provider, label, status) |
| `store-key` | Store a new API key (split and encrypted) |
| `get-usage` | Check usage stats (calls, errors, limits) |
| `proxy-request` | Make API calls through VaultProof's secure proxy |

## How it works

1. You store your API key → VaultProof splits it using secret sharing
2. Claude calls `proxy-request` with the URL and headers (no key)
3. VaultProof reassembles the key server-side, injects it, makes the call
4. Response comes back to Claude — the key never entered Claude's context

That's it. Your agent is useful. Your keys are safe.
