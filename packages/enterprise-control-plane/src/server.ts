import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleEnterpriseControlPlaneRequest, type EnterpriseControlPlaneEnv } from './index.js';
import { withEnterpriseSecurityHeaders } from './security-headers.js';

const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  statusCode = 413;

  constructor() {
    super('Request body too large');
  }
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
      continue;
    }
    if (typeof value === 'string') headers.set(key, value);
  }

  headers.delete('x-vaultproof-local-loopback');
  const remoteAddress = req.socket.remoteAddress;
  if (remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1') {
    headers.set('x-vaultproof-local-loopback', 'true');
  }

  const body = await readRequestBody(req);
  return new Request(url, {
    method: req.method || 'GET',
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (!response.body) {
    res.end();
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

function getEnv(): EnterpriseControlPlaneEnv {
  const mixpanelRecordSessionsPercent = Number.parseFloat(
    process.env.ENTERPRISE_MIXPANEL_RECORD_SESSIONS_PERCENT || '0',
  );
  const executeContextCacheTtlMs = Number.parseInt(
    process.env.ENTERPRISE_EXECUTE_CONTEXT_CACHE_TTL_MS || '3000',
    10,
  );

  return {
    enterpriseHostname: process.env.ENTERPRISE_HOSTNAME,
    enterpriseCloudProvider: process.env.ENTERPRISE_CLOUD_PROVIDER,
    enterpriseRuntimeTier: process.env.ENTERPRISE_RUNTIME_TIER,
    internalAdminHostname: process.env.VAULTPROOF_INTERNAL_ADMIN_HOSTNAME,
    internalAdminPreviewEnabled: process.env.VAULTPROOF_INTERNAL_ADMIN_PREVIEW_ENABLED === 'true',
    internalAdminAllowedEmails: process.env.VAULTPROOF_INTERNAL_ADMIN_EMAILS,
    internalAdminAllowedDomains: process.env.VAULTPROOF_INTERNAL_ADMIN_DOMAINS,
    internalAdminActionsEnabled: process.env.VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED === 'true',
    internalAdminApprovalSecret: process.env.VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET,
    executorBaseUrl: process.env.ENTERPRISE_EXECUTOR_BASE_URL,
    executorSigningKeyId: process.env.ENTERPRISE_EXECUTOR_SIGNING_KEY_ID,
    executorSigningSecret: process.env.ENTERPRISE_EXECUTOR_SIGNING_SECRET,
    enterpriseProxyTokenSecret: process.env.ENTERPRISE_PROXY_TOKEN_SECRET,
    enterpriseExecuteContextCacheTtlMs: Number.isFinite(executeContextCacheTtlMs)
      ? executeContextCacheTtlMs
      : 3000,
    azureFrontDoorId: process.env.ENTERPRISE_AZURE_FRONT_DOOR_ID,
    originLockHeaderName: process.env.ENTERPRISE_ORIGIN_LOCK_HEADER_NAME,
    originLockRequired: process.env.ENTERPRISE_REQUIRE_ORIGIN_LOCK === 'true',
    originLockSecret: process.env.ENTERPRISE_ORIGIN_LOCK_SECRET,
    trustedSourceIpHeaderSecret: process.env.ENTERPRISE_TRUSTED_SOURCE_IP_HEADER_SECRET,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    mixpanelToken: process.env.ENTERPRISE_MIXPANEL_TOKEN,
    mixpanelAutocapture: process.env.ENTERPRISE_MIXPANEL_AUTOCAPTURE === 'true',
    mixpanelRecordSessionsPercent: Number.isFinite(mixpanelRecordSessionsPercent)
      ? mixpanelRecordSessionsPercent
      : 0,
  };
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT || '3001', 10);
  const env = getEnv();

  const server = createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const response = await handleEnterpriseControlPlaneRequest(request, env);
      await writeWebResponse(response, res);
    } catch (error) {
      const statusCode = error instanceof RequestBodyTooLargeError ? error.statusCode : 500;
      const message = statusCode === 413
        ? 'Request body too large'
        : error instanceof Error ? error.message : 'Unexpected server error';
      const response = await withEnterpriseSecurityHeaders(Response.json(
        { error: message },
        {
          status: statusCode,
          headers: { 'cache-control': 'no-store' },
        },
      ));
      await writeWebResponse(response, res);
    }
  });

  server.listen(port, () => {
    console.log(`vaultproof enterprise control plane listening on :${port}`);
  });
}

void main();
