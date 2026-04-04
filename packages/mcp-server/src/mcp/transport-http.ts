/**
 * Streamable HTTP transport for the MCP protocol.
 *
 * Handles POST /mcp — the primary transport for MCP 2024-11-05.
 * Each request is a single JSON-RPC message; responses are returned synchronously.
 */

import { jsonResponse, errorResponse } from '../lib/security-headers.js';
import { validateToken } from '../auth/validate-token.js';
import type { ValidatedSession } from '../auth/validate-token.js';
import { getToolsListResponse } from './tools.js';
import { handleToolCall } from './handler.js';
import type { Env } from '../types.js';

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: string | number | null, result: unknown): object {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): object {
  return {
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handle a POST /mcp request using the Streamable HTTP transport.
 *
 * @param prevalidated - Optional pre-validated session from the caller (index.ts).
 *   When provided, token validation is skipped to avoid a second KV read + TTL refresh.
 *   The caller (index.ts) has already validated the token for rate-limiting purposes.
 */
export async function handleStreamableHttp(
  request: Request,
  env: Env,
  prevalidated?: ValidatedSession,
): Promise<Response> {
  // 1. Validate bearer token (skip if pre-validated by caller)
  let session: ValidatedSession;
  if (prevalidated) {
    session = prevalidated;
  } else {
    const sessionOrResponse = await validateToken(request, env);
    if (sessionOrResponse instanceof Response) return sessionOrResponse;
    session = sessionOrResponse;
  }

  // 2. Parse JSON-RPC body
  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonResponse(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  if (!rpc.method) {
    return jsonResponse(jsonRpcError(rpc.id ?? null, -32600, 'Invalid Request'), 400);
  }

  const id = rpc.id ?? null;

  // 3. Dispatch
  switch (rpc.method) {
    case 'initialize': {
      const result = {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'vaultproof', version: '0.1.0' },
        capabilities: { tools: {} },
      };
      return jsonResponse(jsonRpcResult(id, result));
    }

    case 'tools/list': {
      return jsonResponse(jsonRpcResult(id, getToolsListResponse()));
    }

    case 'tools/call': {
      const params = rpc.params ?? {};
      const toolName = params['name'] as string | undefined;
      const toolArgs = (params['arguments'] ?? {}) as Record<string, unknown>;

      if (!toolName) {
        return jsonResponse(jsonRpcError(id, -32602, 'Invalid params: missing name'), 400);
      }

      const result = await handleToolCall(toolName, toolArgs, session, env, session.userId);
      return jsonResponse(jsonRpcResult(id, result));
    }

    case 'ping': {
      return jsonResponse(jsonRpcResult(id, {}));
    }

    default: {
      // JSON-RPC 2.0: application-level errors use HTTP 200; error info is in the body
      return jsonResponse(jsonRpcError(id, -32601, `Method not found: ${rpc.method}`));
    }
  }
}
