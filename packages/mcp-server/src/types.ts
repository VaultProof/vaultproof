export interface Env {
  BACKEND_URL: string;
  MCP_ISSUER: string;
  PROXY_SECRET: string;
  MCP_SESSION_ENCRYPTION_KEY: string;
  OAUTH_CODES: KVNamespace;
  MCP_SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  RATE_LIMITER?: DurableObjectNamespace;
  OAUTH_CODE_DO?: DurableObjectNamespace;
}
