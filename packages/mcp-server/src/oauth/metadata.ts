import { jsonResponse } from '../lib/security-headers.js';
import type { Env } from '../types.js';

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata
 * GET /.well-known/oauth-protected-resource
 */
export function handleProtectedResourceMetadata(_env: Env): Response {
  return jsonResponse({
    resource: 'https://mcp.vaultproof.dev',
    authorization_servers: ['https://mcp.vaultproof.dev'],
    scopes_supported: ['keys:read', 'keys:write', 'usage:read'],
    bearer_methods_supported: ['header'],
  });
}

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata
 * GET /.well-known/oauth-authorization-server
 */
export function handleAuthorizationServerMetadata(_env: Env): Response {
  return jsonResponse({
    issuer: 'https://mcp.vaultproof.dev',
    authorization_endpoint: 'https://mcp.vaultproof.dev/oauth/authorize',
    token_endpoint: 'https://mcp.vaultproof.dev/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['keys:read', 'keys:write', 'usage:read'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
