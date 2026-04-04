# VaultProof MCP Demo Script (60 seconds)

## What You Need Before Recording

- Claude Desktop with VaultProof MCP server configured
- At least one API key stored in VaultProof (e.g., OpenAI)
- Screen recording tool (QuickTime, OBS, or similar)
- Record at 1080p or higher

## The Script

### Scene 1: The Problem (0–10s)

*Show a terminal or code editor with a .env file containing API keys*

**Text overlay:** "This is how most people give AI agents API access."

*Highlight the plaintext key*

**Text overlay:** "The agent sees your raw key. That's a problem."

### Scene 2: The Setup (10–25s)

*Show Claude Desktop settings → MCP config*

**Text overlay:** "VaultProof MCP server. One line to add."

*Show the config:*

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

**Text overlay:** "That's it."

### Scene 3: The Demo (25–50s)

*In Claude Desktop, type:*

> "Use VaultProof to list my stored keys"

*Show Claude calling `list-keys` and returning results*

*Then type:*

> "Use VaultProof to call the OpenAI API and list my available models"

*Show Claude calling `proxy-request`, getting back the model list*

**Text overlay:** "Claude called the OpenAI API. It never saw the key."

### Scene 4: The CTA (50–60s)

**Text overlay:**

"VaultProof — API key security for AI agents"

"Free at vaultproof.dev"

## Output Formats

- **Full 60s video** → Twitter/X, LinkedIn
- **30s cut** (Scene 2+3 only) → Reddit, short-form
- **GIF of Scene 3** → HN comment, GitHub README
