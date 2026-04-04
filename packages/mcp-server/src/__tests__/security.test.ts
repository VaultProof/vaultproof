/**
 * Security regression tests for Phase 4 hardening.
 *
 * Covers:
 *   1. Injection defense — add_key `value` Zod schema rejects dangerous inputs.
 *   2. Key leak detection — list_keys / get_proxy_url never expose raw key material.
 *   3. WWW-Authenticate header — validateToken returns 401 + header on all rejection paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOLS } from '../mcp/tools.js';
import { handleToolCall } from '../mcp/handler.js';
import { validateToken } from '../auth/validate-token.js';
import type { Env } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock KV namespace. */
function mockKv(store: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace;
}

/** Build a minimal Env with all KV bindings mocked. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BACKEND_URL: 'https://backend.example.com',
    MCP_ISSUER: 'https://mcp.vaultproof.dev',
    PROXY_SECRET: 'a'.repeat(64),
    MCP_SESSION_ENCRYPTION_KEY: 'a'.repeat(64),
    OAUTH_CODES: mockKv(),
    MCP_SESSIONS: mockKv(),
    RATE_LIMIT: mockKv(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Injection defense — add_key `value` field Zod schema
// ---------------------------------------------------------------------------

describe('injection defense: add_key value schema', () => {
  // Locate the add_key tool and extract its value property descriptor
  const addKeyTool = TOOLS.find((t) => t.name === 'add_key')!;
  const valueProp = addKeyTool.inputSchema.properties['value'] as {
    type: string;
    pattern: string;
    minLength: number;
    maxLength: number;
  };

  it('add_key tool exists with a value property', () => {
    expect(addKeyTool).toBeDefined();
    expect(valueProp).toBeDefined();
    expect(valueProp.pattern).toBe('^[a-zA-Z0-9\\-_.]+$');
  });

  const pattern = new RegExp(`^${valueProp.pattern.slice(1, -1)}$`);
  const maxLength = valueProp.maxLength;

  const dangerous = [
    "'; DROP TABLE keys; --",
    '<script>alert(1)</script>',
    '${process.env.SECRET}',
    '\x00null\x00byte',
    'a'.repeat(513),      // over maxLength (512)
    'key with spaces',    // spaces not in value pattern
    'key\nnewline',
  ];

  for (const input of dangerous) {
    it(`rejects dangerous input: ${JSON.stringify(input).slice(0, 60)}`, () => {
      const withinLength = input.length <= maxLength;
      const matchesPattern = pattern.test(input);
      // Input must fail at least one constraint (length or pattern)
      expect(withinLength && matchesPattern).toBe(false);
    });
  }

  const valid = ['sk-abc123', 'key-1.2_3', 'Bearer_token'];

  for (const input of valid) {
    it(`accepts valid input: ${input}`, () => {
      expect(input.length >= valueProp.minLength).toBe(true);
      expect(input.length <= maxLength).toBe(true);
      expect(pattern.test(input)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Key leak detection — handler responses never contain raw key material
// ---------------------------------------------------------------------------

describe('key leak detection: list_keys strips sensitive fields', () => {
  // Mock callBackend to return a response with sensitive-looking fields
  beforeEach(() => {
    vi.mock('../backend/client.js', () => ({
      callBackend: vi.fn(async () => {
        const body = JSON.stringify({
          keys: [
            {
              provider: 'openai',
              label: 'my-key',
              createdAt: '2024-01-01T00:00:00Z',
              status: 'active',
              // These should NEVER appear in the tool response:
              rawKey: 'sk-abc123SECRETKEY',
              encryptedShare: 'vp_live_abc123secrettoken',
              keyHash: 'sha256:deadbeef',
              apiKey: 'sk-ant-api03-SECRETANTHROPICKEY',
            },
          ],
        });
        return new Response(body, { status: 200 });
      }),
    }));
  });

  it('list_keys response does not contain raw key material', async () => {
    const env = makeEnv();
    const session = {
      userId: 'user-123',
      scope: 'keys:read keys:write usage:read',
      sessionId: 'sess-abc',
      boundSessionId: 'sess-abc',
      encryptedDevKey: 'ZW5jcnlwdGVk', // placeholder, won't actually decrypt in this test
    };

    // We need to mock decryptAesGcm too since we can't actually decrypt
    vi.mock('../lib/crypto.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../lib/crypto.js')>();
      return {
        ...actual,
        decryptAesGcm: vi.fn(async () => 'vp_live_mockdevkey'),
      };
    });

    const result = await handleToolCall('list_keys', {}, session, env, session.userId);
    const resultStr = JSON.stringify(result);

    // Must not contain any raw key material patterns
    expect(resultStr).not.toMatch(/vp_live_[a-zA-Z0-9]+/);
    expect(resultStr).not.toMatch(/sk-[a-zA-Z0-9]+/);
    expect(resultStr).not.toMatch(/sk-ant-[a-zA-Z0-9]+/);

    // Must not contain the sensitive field names
    expect(resultStr).not.toContain('rawKey');
    expect(resultStr).not.toContain('encryptedShare');
    expect(resultStr).not.toContain('keyHash');
    expect(resultStr).not.toContain('apiKey');
  });
});

describe('key leak detection: get_proxy_url strips sensitive fields', () => {
  it('get_proxy_url response does not expose raw key material', async () => {
    // The get_proxy_url handler constructs its URL from provider enum, never user input.
    // It only returns { proxyUrl: string } — verify no key material leaks.
    const env = makeEnv();
    const session = {
      userId: 'user-123',
      scope: 'keys:read keys:write usage:read',
      sessionId: 'sess-abc',
      boundSessionId: 'sess-abc',
      encryptedDevKey: 'ZW5jcnlwdGVk',
    };

    // callBackend is still mocked from the module-level vi.mock above
    const result = await handleToolCall(
      'get_proxy_url',
      { label: 'my-key' },
      session,
      env,
      session.userId,
    );
    const resultStr = JSON.stringify(result);

    expect(resultStr).not.toMatch(/vp_live_[a-zA-Z0-9]+/);
    expect(resultStr).not.toMatch(/sk-[a-zA-Z0-9]+/);
    expect(resultStr).not.toMatch(/sk-ant-[a-zA-Z0-9]+/);
    expect(resultStr).not.toContain('rawKey');
    expect(resultStr).not.toContain('encryptedShare');
  });
});

// ---------------------------------------------------------------------------
// 3. WWW-Authenticate header on all 401 token rejection paths
// ---------------------------------------------------------------------------

describe('validateToken: WWW-Authenticate header on 401s', () => {
  const expectedWwwAuth =
    'Bearer realm="mcp.vaultproof.dev", resource_metadata_uri="https://mcp.vaultproof.dev/.well-known/oauth-protected-resource"';

  function makeRequest(authHeader?: string): Request {
    const headers: Record<string, string> = {};
    if (authHeader !== undefined) {
      headers['Authorization'] = authHeader;
    }
    return new Request('https://mcp.vaultproof.dev/mcp', {
      method: 'POST',
      headers,
    });
  }

  it('returns 401 + WWW-Authenticate when Authorization header is missing', async () => {
    const env = makeEnv();
    const result = await validateToken(makeRequest(), env);

    expect(result instanceof Response).toBe(true);
    const resp = result as Response;
    expect(resp.status).toBe(401);
    expect(resp.headers.get('WWW-Authenticate')).toBe(expectedWwwAuth);
  });

  it('returns 401 + WWW-Authenticate for a JWT token (3 dot-separated parts)', async () => {
    const env = makeEnv();
    const result = await validateToken(makeRequest('Bearer eyJ.eyJ.sig'), env);

    expect(result instanceof Response).toBe(true);
    const resp = result as Response;
    expect(resp.status).toBe(401);
    expect(resp.headers.get('WWW-Authenticate')).toBe(expectedWwwAuth);
  });

  it('returns 401 + WWW-Authenticate for a vp_live_ prefixed developer key', async () => {
    const env = makeEnv();
    const result = await validateToken(makeRequest('Bearer vp_live_abc123'), env);

    expect(result instanceof Response).toBe(true);
    const resp = result as Response;
    expect(resp.status).toBe(401);
    expect(resp.headers.get('WWW-Authenticate')).toBe(expectedWwwAuth);
  });

  it('returns 401 + WWW-Authenticate for an unknown/expired opaque token', async () => {
    // KV returns null — session not found
    const env = makeEnv({
      MCP_SESSIONS: mockKv({}), // empty store
    });
    const result = await validateToken(makeRequest('Bearer unknowntoken123'), env);

    expect(result instanceof Response).toBe(true);
    const resp = result as Response;
    expect(resp.status).toBe(401);
    expect(resp.headers.get('WWW-Authenticate')).toBe(expectedWwwAuth);
  });
});
