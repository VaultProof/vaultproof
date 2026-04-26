import type {
  SecureExecutionRequest,
  SecureExecutionResult,
} from '@vaultproof/core';

export interface ResolvedSecureExecutionMaterial {
  apiKey: string;
  upstreamBaseUrl: string;
  authHeaderName: string;
  authHeaderTemplate: string;
  extraHeaders?: Record<string, string> | null;
}

export interface ExecuteUpstreamDependencies {
  fetchImpl?: typeof fetch;
}

const SAFE_FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'user-agent',
  'openai-beta',
  'stripe-version',
  'idempotency-key',
  'prefer',
  'anthropic-version',
  'anthropic-beta',
]);

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'www-authenticate',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-request-id',
  'openai-version',
  'openai-processing-ms',
  'openai-organization',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-remaining',
  'stripe-version',
  'request-id',
]);

function toArrayBuffer(base64: string): ArrayBuffer {
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function filterForwardHeaders(headers: Record<string, string>): Headers {
  const forwardHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (SAFE_FORWARD_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }
  return forwardHeaders;
}

function buildUpstreamUrl(baseUrl: string, upstreamPath: string, query: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const queryString = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${base}${path}${queryString}`;
}

function buildAuthHeaderValue(template: string, apiKey: string): string {
  return template.replace(/\{key\}/g, apiKey);
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) {
      output[key] = value;
    }
  }
  return output;
}

function getProviderRequestId(headers: Headers): string | null {
  return headers.get('x-request-id') || headers.get('request-id');
}

export async function executeUpstreamRequest(
  request: SecureExecutionRequest,
  material: ResolvedSecureExecutionMaterial,
  dependencies: ExecuteUpstreamDependencies = {},
): Promise<SecureExecutionResult> {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const upstreamUrl = buildUpstreamUrl(material.upstreamBaseUrl, request.upstreamPath, request.query);
  const forwardHeaders = filterForwardHeaders(request.headers);
  forwardHeaders.set(
    material.authHeaderName,
    buildAuthHeaderValue(material.authHeaderTemplate, material.apiKey),
  );

  if (material.extraHeaders) {
    for (const [key, value] of Object.entries(material.extraHeaders)) {
      forwardHeaders.set(key, value.includes('{key}') ? value.replace(/\{key\}/g, material.apiKey) : value);
    }
  }

  const requestBody = request.bodyBase64 ? toArrayBuffer(request.bodyBase64) : undefined;

  try {
    const upstreamResponse = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : requestBody,
      redirect: 'manual',
    });

    const responseBody = upstreamResponse.body
      ? toBase64(new Uint8Array(await upstreamResponse.arrayBuffer()))
      : null;

    return {
      requestId: request.requestId,
      status: upstreamResponse.status,
      headers: sanitizeResponseHeaders(upstreamResponse.headers),
      bodyBase64: responseBody,
      providerRequestId: getProviderRequestId(upstreamResponse.headers),
      error: null,
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      status: 502,
      headers: {},
      bodyBase64: null,
      providerRequestId: null,
      error: error instanceof Error ? error.message : 'upstream_fetch_failed',
    };
  }
}
