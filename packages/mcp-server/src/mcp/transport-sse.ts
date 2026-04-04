/**
 * SSE transport for the MCP protocol (legacy compatibility).
 *
 * GET  /mcp/sse         — Opens an SSE stream, sends the message endpoint, then closes.
 * POST /mcp/sse/message — Handles JSON-RPC messages from the client (same dispatch as HTTP).
 *
 * Because Cloudflare Workers are stateless (no shared memory between requests),
 * this implements a "redirect to HTTP" pattern:
 *   1. Client opens GET /mcp/sse.
 *   2. Server validates the token and immediately sends the `endpoint` event
 *      pointing to POST /mcp (the Streamable HTTP transport).
 *   3. The SSE connection stays open for a short time then closes with retry guidance.
 *   4. The client uses POST /mcp for all subsequent messages.
 */

import { validateToken } from '../auth/validate-token.js';
import type { ValidatedSession } from '../auth/validate-token.js';
import { errorResponse } from '../lib/security-headers.js';
import { handleStreamableHttp } from './transport-http.js';
import type { Env } from '../types.js';

/**
 * GET /mcp/sse
 *
 * Validates the bearer token and returns an SSE stream that:
 * - Immediately sends an `endpoint` event with the message URL.
 * - Stays open for up to 25 s (Cloudflare Worker CPU limit protection).
 * - Closes with a `retry: 3000` directive so clients reconnect after 3 s.
 */
export async function handleSse(request: Request, env: Env): Promise<Response> {
  // Validate token before opening the stream
  const sessionOrResponse = await validateToken(request, env);
  if (sessionOrResponse instanceof Response) {
    return sessionOrResponse;
  }

  // Validate session binding — Mcp-Session-Id header must match boundSessionId
  const mcpSessionId = request.headers.get('Mcp-Session-Id') || request.headers.get('X-MCP-Session-Id');
  if (mcpSessionId && mcpSessionId !== sessionOrResponse.boundSessionId) {
    return errorResponse(403, 'forbidden', 'Session ID mismatch');
  }

  // Token is valid — session data not needed for SSE redirect transport
  // Build the SSE stream using the Streams API (available in Workers)
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  // Write the endpoint event and a keepalive comment, then close
  const write = (data: string): Promise<void> => writer.write(enc.encode(data));

  // Fire-and-forget: write events and close within the Worker's lifetime
  (async () => {
    try {
      // Send the endpoint event pointing clients to the Streamable HTTP transport
      await write(`event: endpoint\ndata: /mcp\n\n`);
      // Generic keepalive comment — no session metadata in stream
      await write(`: keepalive\n\n`);
      // Retry directive: if the connection drops, wait 3 s before reconnecting
      await write(`retry: 3000\n\n`);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * POST /mcp/sse/message
 *
 * Accepts JSON-RPC messages on the SSE message channel and processes them
 * using the same dispatch logic as the Streamable HTTP transport.
 *
 * The sessionId query param is accepted but not required — authentication
 * is always performed via the Authorization: Bearer header.
 */
export async function handleSseMessage(
  request: Request,
  env: Env,
  prevalidated?: ValidatedSession,
): Promise<Response> {
  // Re-use the full Streamable HTTP handler — auth + dispatch are identical.
  // Pass prevalidated session when provided by index.ts to avoid a second KV read.
  return handleStreamableHttp(request, env, prevalidated);
}
