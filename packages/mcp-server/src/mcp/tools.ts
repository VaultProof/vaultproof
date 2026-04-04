/**
 * MCP tool definitions for the VaultProof MCP server.
 *
 * All tool descriptions are STATIC strings — never derived from user input or env vars.
 * Input schemas are JSON Schema-compatible objects that are also used to build Zod validators
 * in the handler.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  requiredScope: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const TOOLS: McpTool[] = [
  {
    name: 'list_keys',
    description:
      'List all API keys stored in your VaultProof vault. Returns key labels and providers only — never the raw key values.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScope: 'keys:read',
    annotations: { readOnlyHint: true, title: 'List stored keys' },
  },
  {
    name: 'get_proxy_url',
    description:
      "Get the VaultProof proxy URL for a stored API key. Use this URL as the base URL in your SDK instead of the provider's URL — your key is never exposed.",
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'The label of the key to get a proxy URL for',
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9 _\\-.]+$',
        },
      },
      required: ['label'],
    },
    requiredScope: 'keys:read',
    annotations: { readOnlyHint: true, title: 'Get proxy URL' },
  },
  {
    name: 'add_key',
    description:
      'Store a new API key in your VaultProof vault. The key is split using Shamir Secret Sharing the moment it is received — it never exists whole on any server.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'The AI provider this key belongs to',
          enum: [
            'openai',
            'anthropic',
            'google',
            'together',
            'mistral',
            'cohere',
            'groq',
            'perplexity',
            'fireworks',
            'deepseek',
            'replicate',
          ],
        },
        label: {
          type: 'string',
          description: 'A friendly name for this key',
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9 _\\-.]+$',
        },
        value: {
          type: 'string',
          description: 'The API key value to store',
          minLength: 1,
          maxLength: 512,
          pattern: '^[a-zA-Z0-9\\-_.]+$',
        },
      },
      required: ['provider', 'label', 'value'],
    },
    requiredScope: 'keys:write',
    annotations: { destructiveHint: true, title: 'Store new API key' },
  },
  {
    name: 'revoke_key',
    description:
      'Permanently revoke and delete an API key from your VaultProof vault.',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'The label of the key to revoke',
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9 _\\-.]+$',
        },
      },
      required: ['label'],
    },
    requiredScope: 'keys:write',
    annotations: { destructiveHint: true, title: 'Revoke API key' },
  },
  {
    name: 'get_usage',
    description: 'Get API usage statistics for your VaultProof vault.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back (1-90, default 30)',
          minimum: 1,
          maximum: 90,
        },
      },
      required: [],
    },
    requiredScope: 'usage:read',
    annotations: { readOnlyHint: true, title: 'Get usage statistics' },
  },
];

/**
 * Returns the MCP tools/list result payload (the inner result object,
 * not the full JSON-RPC envelope — the transport layer wraps it).
 */
export async function getToolsListResponse(): Promise<object> {
  const hash = await getToolsHash();
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
    _meta: { toolsHash: hash },
  };
}

/**
 * Compute a SHA-256 hash of all tool definitions for integrity verification.
 * Clients can pin this hash and verify tools haven't been tampered with.
 * Defends against MCP tool poisoning / rug pull attacks.
 */
let cachedToolsHash: string | null = null;

export async function getToolsHash(): Promise<string> {
  if (cachedToolsHash) return cachedToolsHash;
  const serialized = JSON.stringify(TOOLS);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  cachedToolsHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return cachedToolsHash;
}
