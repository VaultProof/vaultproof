/**
 * MCP tool call handler.
 *
 * Validates scope, validates input args against each tool's inputSchema,
 * then dispatches to the appropriate backend call.
 */

import { z } from 'zod';
import { decryptAesGcm } from '../lib/crypto.js';
import { callBackend } from '../backend/client.js';
import type { ValidatedSession } from '../auth/validate-token.js';
import type { Env } from '../types.js';
import { TOOLS } from './tools.js';
import { checkAddKeyRateLimit } from '../lib/rate-limit.js';
import { splitString, serializeShare } from '../lib/shamir.js';
import { encryptShare2 } from '../lib/share2-encrypt.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Session extended with the encrypted developer key (for backend calls). */
export type SessionWithKey = ValidatedSession & { encryptedDevKey: string };

/** A stripped-down key record returned to the client — never includes raw key material. */
interface SafeKeyRecord {
  provider: string;
  label: string;
  createdAt: string;
  status: string;
}

// ─── JSON Schema → Zod helpers ────────────────────────────────────────────────

/**
 * Build a Zod validator from a JSON-Schema-like property descriptor.
 * Supports: type string/number, enum, minLength, maxLength, pattern,
 * minimum, maximum.
 */
function buildPropertySchema(prop: Record<string, unknown>): z.ZodTypeAny {
  if (prop['type'] === 'string') {
    let s = z.string();
    if (typeof prop['minLength'] === 'number') s = s.min(prop['minLength']);
    if (typeof prop['maxLength'] === 'number') s = s.max(prop['maxLength']);
    if (typeof prop['pattern'] === 'string') s = s.regex(new RegExp(prop['pattern']));
    if (Array.isArray(prop['enum'])) {
      const values = prop['enum'] as [string, ...string[]];
      return z.enum(values);
    }
    return s;
  }

  if (prop['type'] === 'number') {
    let n = z.number();
    if (typeof prop['minimum'] === 'number') n = n.min(prop['minimum']);
    if (typeof prop['maximum'] === 'number') n = n.max(prop['maximum']);
    return n;
  }

  // Fallback: accept anything
  return z.unknown();
}

/**
 * Build a Zod object schema from a JSON Schema-like inputSchema definition.
 */
function buildZodSchema(inputSchema: {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(inputSchema.required ?? []);

  for (const [key, propRaw] of Object.entries(inputSchema.properties)) {
    const prop = propRaw as Record<string, unknown>;
    let fieldSchema = buildPropertySchema(prop);
    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

// ─── MCP content helpers ──────────────────────────────────────────────────────

function mcpResult(data: unknown): object {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function mcpError(message: string): object {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Response sanitization ───────────────────────────────────────────────────

/**
 * Sanitize a string field from a backend response.
 * Removes control characters and null bytes, enforces max length.
 * Returns null if the input is not a string.
 */
function sanitizeString(s: unknown, maxLen = 256): string | null {
  if (typeof s !== 'string') return null;
  // Remove control characters and null bytes
  const clean = s.replace(/[\x00-\x1f\x7f]/g, '');
  if (clean.length > maxLen) return clean.slice(0, maxLen);
  return clean;
}

// ─── Valid providers whitelist (Fix 6) ───────────────────────────────────────

const VALID_PROVIDERS = new Set([
  'openai', 'anthropic', 'google', 'together', 'mistral',
  'cohere', 'groq', 'perplexity', 'fireworks', 'deepseek', 'replicate',
  'stripe', 'minimax',
]);

// ─── Allowlist response fields ────────────────────────────────────────────────

/**
 * Strip all sensitive fields from a key record.
 * Only provider, label, createdAt, and status are safe to return.
 */
function toSafeKeyRecord(raw: Record<string, unknown>): SafeKeyRecord {
  return {
    provider: sanitizeString(raw['provider'], 64) ?? '',
    label: sanitizeString(raw['label'], 128) ?? '',
    createdAt: sanitizeString(raw['createdAt'], 64) ?? '',
    status: sanitizeString(raw['status'], 32) ?? 'active',
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  session: SessionWithKey,
  env: Env,
  userId: string,
): Promise<object> {
  // 1. Find the tool
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return { error: { code: -32601, message: 'Tool not found' } };
  }

  // 2. Check scope
  if (!session.scope.split(' ').includes(tool.requiredScope)) {
    return {
      error: {
        code: -32403,
        message: 'Insufficient scope',
        data: { required: tool.requiredScope },
      },
    };
  }

  // 3. Validate args against inputSchema
  const zodSchema = buildZodSchema(tool.inputSchema);
  const parseResult = zodSchema.safeParse(args);
  if (!parseResult.success) {
    const message = parseResult.error.issues.map((i) => i.message).join('; ');
    return mcpError(`Invalid arguments: ${message}`);
  }

  // 4. Decrypt the dev key
  let devKey: string;
  try {
    devKey = await decryptAesGcm(session.encryptedDevKey, env.MCP_SESSION_ENCRYPTION_KEY);
  } catch {
    return mcpError('Failed to decrypt session credentials');
  }

  // 5. Dispatch to the appropriate backend call
  try {
    switch (toolName) {
      case 'list_keys': {
        const resp = await callBackend('/api/v1/sdk/keys', 'GET', undefined, devKey, env);
        if (!resp.ok) {
          return mcpError(`Backend error: ${resp.status}`);
        }
        const data = (await resp.json()) as { keys?: Record<string, unknown>[] };
        const keys = (data.keys ?? []).map(toSafeKeyRecord);
        return mcpResult({ keys });
      }

      case 'get_proxy_url': {
        const label = args['label'] as string;
        const resp = await callBackend('/api/v1/sdk/keys', 'GET', undefined, devKey, env);
        if (!resp.ok) {
          return mcpError(`Backend error: ${resp.status}`);
        }
        const data = (await resp.json()) as { keys?: Record<string, unknown>[] };
        const keys = data.keys ?? [];
        const found = keys.find((k) => k['label'] === label);
        if (!found) {
          return mcpError(`Key not found: ${label}`);
        }
        // Validate provider against whitelist — prevents path traversal via compromised backend
        const provider = String(found['provider'] ?? '');
        if (!VALID_PROVIDERS.has(provider)) {
          return mcpError(`Unsupported provider: ${provider}`);
        }
        const proxyUrl = `https://api.vaultproof.dev/v1/${provider}`;
        return mcpResult({ proxyUrl });
      }

      case 'add_key': {
        const addKeyAllowed = await checkAddKeyRateLimit(userId, env);
        if (!addKeyAllowed) {
          return mcpError('Rate limit exceeded: too many add_key calls. Try again later.');
        }
        const { provider, label, value } = args as {
          provider: string;
          label: string;
          value: string;
        };

        // Split the raw key into 2 Shamir shares (threshold=2)
        const shares = splitString(value, 2, 2);
        const share1 = serializeShare(shares[0]!);
        const share2Raw = serializeShare(shares[1]!);

        // Encrypt share2 with the developer's vp_live_ key
        const share2Encrypted = await encryptShare2(share2Raw, devKey);

        const resp = await callBackend(
          '/api/v1/sdk/store',
          'POST',
          { share1, share2: share2Encrypted, provider, label },
          devKey,
          env,
        );
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
          return mcpError(sanitizeString(body['error'], 256) ?? `Backend error: ${resp.status}`);
        }
        return mcpResult({ success: true, message: 'Key stored successfully' });
      }

      case 'revoke_key': {
        const label = args['label'] as string;
        // First look up the keyId by label
        const listResp = await callBackend('/api/v1/sdk/keys', 'GET', undefined, devKey, env);
        if (!listResp.ok) {
          return mcpError(`Backend error: ${listResp.status}`);
        }
        const listData = (await listResp.json()) as { keys?: Record<string, unknown>[] };
        const keys = listData.keys ?? [];
        const found = keys.find((k) => k['label'] === label);
        if (!found) {
          return mcpError(`Key not found: ${label}`);
        }
        const keyId = found['id'] as string | undefined;
        if (!keyId) {
          return mcpError('Key record is missing an id field');
        }
        const revokeResp = await callBackend(
          '/api/v1/sdk/revoke',
          'POST',
          { keyId },
          devKey,
          env,
        );
        if (!revokeResp.ok) {
          const body = (await revokeResp.json().catch(() => ({}))) as Record<string, unknown>;
          return mcpError(sanitizeString(body['error'], 256) ?? `Backend error: ${revokeResp.status}`);
        }
        return mcpResult({ success: true, message: 'Key revoked successfully' });
      }

      case 'get_usage': {
        const days = (args['days'] as number | undefined) ?? 30;
        const resp = await callBackend(
          `/api/v1/stats/usage?days=${days}`,
          'GET',
          undefined,
          devKey,
          env,
        );
        if (!resp.ok) {
          return mcpError(`Backend error: ${resp.status}`);
        }
        const raw = await resp.json() as Record<string, unknown>;
        // Allowlist fields — never forward internal billing or user metadata.
        // Coerce types explicitly so a compromised backend can't inject arbitrary values.
        const safe = {
          requests: typeof raw['requests'] === 'number' ? raw['requests'] : null,
          tokens:   typeof raw['tokens']   === 'number' ? raw['tokens']   : null,
          period:   sanitizeString(raw['period'], 64),
          days:     typeof raw['days']     === 'number' ? raw['days']     : null,
        };
        return mcpResult(safe);
      }

      default:
        return { error: { code: -32601, message: 'Tool not found' } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return mcpError(`Tool execution failed: ${message}`);
  }
}
