import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  handleEnterpriseSecureExecutorRequestWithEnv,
  type EnterpriseSecureExecutorEnv,
} from './index.js';

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

function parseAcceptedSigningKeys(raw?: string): Record<string, string> {
  if (!raw) return {};

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex <= 0) return acc;

      const keyId = entry.slice(0, separatorIndex).trim();
      const secret = entry.slice(separatorIndex + 1).trim();
      if (!keyId || !secret) return acc;

      acc[keyId] = secret;
      return acc;
    }, {});
}

function getEnv(): EnterpriseSecureExecutorEnv {
  return {
    acceptedSigningKeys: parseAcceptedSigningKeys(process.env.ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vaultEncryptionKey: process.env.VAULT_ENCRYPTION_KEY,
    executorMode: process.env.VAULTPROOF_EXECUTOR_MODE,
    azureKeyReleaseUrl: process.env.AZURE_KEY_RELEASE_URL,
    azureAttestationToken: process.env.AZURE_ATTESTATION_TOKEN,
    azureAttestationClientPath: process.env.AZURE_ATTESTATION_CLIENT_PATH,
    azureKeyVaultAccessToken: process.env.AZURE_KEY_VAULT_ACCESS_TOKEN,
    azureKeyReleaseEnc: process.env.AZURE_KEY_RELEASE_ENC,
    azureKeyReleaseCacheTtlMs: Number.parseInt(process.env.AZURE_KEY_RELEASE_CACHE_TTL_MS || '', 10),
    azureAttestationProviderUri: process.env.AZURE_ATTESTATION_PROVIDER_URI,
    azureAttestationTokenHash: process.env.AZURE_ATTESTATION_TOKEN_HASH,
    azureKeyReleasePolicyHash: process.env.AZURE_KEY_RELEASE_POLICY_HASH,
    azureKeyId: process.env.AZURE_KEY_ID,
    azureKeyVersion: process.env.AZURE_KEY_VERSION,
    executorBuildDigest: process.env.VAULTPROOF_EXECUTOR_BUILD_DIGEST,
    azureConfidentialVmResourceId: process.env.AZURE_CONFIDENTIAL_VM_RESOURCE_ID,
    azureMeasurementSummary: process.env.AZURE_MEASUREMENT_SUMMARY,
    demoSeedToken: process.env.ENTERPRISE_DEMO_SEED_TOKEN,
    allowDemoSeedRoute: process.env.ENTERPRISE_ALLOW_DEMO_SEED === 'true',
  };
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT || '3002', 10);
  const env = getEnv();

  const server = createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const response = await handleEnterpriseSecureExecutorRequestWithEnv(request, env);
      await writeWebResponse(response, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error';
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(port, () => {
    console.log(`vaultproof enterprise secure executor listening on :${port}`);
  });
}

void main();
