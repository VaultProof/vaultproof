import {
  buildSignedSecureExecutionEnvelope,
} from '../packages/vaultproof-core/dist/index.js';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleEnterpriseSecureExecutorRequestWithEnv,
} from '../packages/enterprise-secure-executor/dist/enterprise-secure-executor/src/index.js';
import {
  NullExecutionResultRecorder,
} from '../packages/enterprise-secure-executor/dist/enterprise-secure-executor/src/material.js';
import {
  InMemoryReplayGuard,
} from '../packages/enterprise-secure-executor/dist/enterprise-secure-executor/src/replay-guard.js';
import {
  AzureSecureKeyReleaseProvider,
  GcpKmsVaultUnwrapKeyProvider,
} from '../packages/enterprise-secure-executor/dist/enterprise-secure-executor/src/key-release.js';

const SIGNING_KEY_ID = 'enterprise-local';
const SIGNING_SECRET = 'local-smoke-secret';

function makeRequest(body) {
  return new Request('http://localhost/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function assertValidEnvelope() {
  const envelope = await buildSignedSecureExecutionEnvelope({
    keyId: SIGNING_KEY_ID,
    secret: SIGNING_SECRET,
    request: {
      requestId: 'req_smoke_001',
      projectId: 'proj_123',
      projectKeyId: 'pk_123',
      organizationId: 'org_123',
      provider: 'openai',
      slug: 'primary',
      method: 'POST',
      upstreamPath: '/v1/responses',
      query: '',
      headers: {
        'content-type': 'application/json',
      },
      bodyBase64: Buffer.from(JSON.stringify({ input: 'hello' })).toString('base64'),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: 'nonce-smoke-001',
    },
  });

  const response = await handleEnterpriseSecureExecutorRequestWithEnv(
    makeRequest(envelope),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: {
            'x-vaultproof-smoke': 'yes',
          },
        }),
      },
      resultRecorder: new NullExecutionResultRecorder(),
      replayGuard: new InMemoryReplayGuard(),
      keyProvider: {
        mode: 'azure-secure-key-release',
        hardwareBound: true,
        getVaultUnwrapKey: async () => 'unused-in-smoke-because-material-is-injected',
        getAttestationEvidence: async () => ({
          provider: 'azure-confidential-vm',
          attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
          attestationTokenHash: 'attestation-token-sha256',
          keyReleasePolicyHash: 'release-policy-sha256',
          keyId: 'https://vaultproof-kv.vault.azure.net/keys/vaultproof-enterprise-unwrap',
          keyVersion: 'key-version-1',
          executorBuildDigest: 'sha256:executor-build',
          confidentialVmResourceId: '/subscriptions/test/resourceGroups/vaultproof-enterprise/providers/Microsoft.Compute/virtualMachines/vpent-executor-cvm',
          claims: {
            attestationType: 'azure-maa',
            secureBoot: true,
            vmIsolation: 'azure-confidential-vm',
            measurementSummary: 'approved-vtpm-measurement',
          },
        }),
      },
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url !== 'https://api.openai.com/v1/responses') {
          throw new Error(`Unexpected upstream url: ${url}`);
        }

        const headers = new Headers(init?.headers);
        if (headers.get('authorization') !== 'Bearer sk-enterprise-smoke') {
          throw new Error('Missing expected authorization header');
        }
        if (headers.get('content-type') !== 'application/json') {
          throw new Error('Missing expected content-type header');
        }
        if (headers.get('x-vaultproof-smoke') !== 'yes') {
          throw new Error('Missing expected extra header');
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_upstream_123',
            'set-cookie': 'blocked=true',
          },
        });
      },
    },
  );

  const payload = await response.json();
  if (response.status !== 200 || payload?.requestId !== envelope.request.requestId) {
    throw new Error(`Expected 200 execution result for valid envelope, got ${response.status}`);
  }
  if (payload?.providerRequestId !== 'req_upstream_123') {
    throw new Error('Expected upstream request id to be preserved');
  }
  if (payload?.headers?.['set-cookie']) {
    throw new Error('Unsafe response header should not be forwarded');
  }
  if (!payload?.bodyBase64) {
    throw new Error('Expected base64 response body');
  }
  if (payload?.attestation?.provider !== 'azure-confidential-vm') {
    throw new Error('Expected Azure confidential VM attestation evidence on execution result');
  }
  if (payload?.attestation?.claims?.attestationType !== 'azure-maa') {
    throw new Error('Expected Azure MAA claim summary on execution result');
  }
}

async function assertReplayBlocked() {
  const replayGuard = new InMemoryReplayGuard();
  const envelope = await buildSignedSecureExecutionEnvelope({
    keyId: SIGNING_KEY_ID,
    secret: SIGNING_SECRET,
    request: {
      requestId: 'req_smoke_replay',
      projectId: 'proj_123',
      projectKeyId: 'pk_123',
      organizationId: 'org_123',
      provider: 'openai',
      slug: 'primary',
      method: 'GET',
      upstreamPath: '/v1/models',
      query: '',
      headers: {},
      bodyBase64: null,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: 'nonce-smoke-replay',
    },
  });

  const env = {
    acceptedSigningKeys: {
      [SIGNING_KEY_ID]: SIGNING_SECRET,
    },
    materialResolver: {
      resolveExecutionMaterial: async () => ({
        apiKey: 'sk-enterprise-smoke',
        upstreamBaseUrl: 'https://api.openai.com',
        authHeaderName: 'authorization',
        authHeaderTemplate: 'Bearer {key}',
        extraHeaders: null,
      }),
    },
    resultRecorder: new NullExecutionResultRecorder(),
    replayGuard,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  };

  const first = await handleEnterpriseSecureExecutorRequestWithEnv(makeRequest(envelope), env);
  if (first.status !== 200) {
    throw new Error(`Expected first replay smoke request to succeed, got ${first.status}`);
  }

  const second = await handleEnterpriseSecureExecutorRequestWithEnv(makeRequest(envelope), env);
  if (second.status !== 409) {
    throw new Error(`Expected replayed request to be blocked with 409, got ${second.status}`);
  }
}

async function assertHealthReadinessProfiles() {
  const demoHealth = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/health'),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      vaultEncryptionKey: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: null,
        }),
      },
    },
  );
  const demoPayload = await demoHealth.json();
  if (demoPayload?.production_ready !== false) {
    throw new Error('Expected demo health profile to report production_ready=false');
  }
  if (!demoPayload?.production_blockers?.includes('key release is not hardware-bound')) {
    throw new Error('Expected demo health profile to explain non-hardware key release blocker');
  }

  const productionHealth = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/health'),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: null,
        }),
      },
      executorMode: 'confidential',
      azureKeyReleaseUrl: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/key-version-1/release',
      azureAttestationClientPath: '/usr/local/bin/AttestationClient',
      azureAttestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
      keyProvider: {
        mode: 'azure-secure-key-release',
        hardwareBound: true,
        getVaultUnwrapKey: async () => 'unused-in-health-smoke',
        getAttestationEvidence: async () => ({
          provider: 'azure-confidential-vm',
          attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
          attestationTokenHash: 'attestation-token-sha256',
          keyReleasePolicyHash: 'release-policy-sha256',
          keyId: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap',
          keyVersion: 'key-version-1',
          executorBuildDigest: 'sha256:executor-build',
          confidentialVmResourceId: '/subscriptions/test/resourceGroups/vaultproof-enterprise/providers/Microsoft.Compute/virtualMachines/vpent-executor-cvm',
          claims: {
            attestationType: 'azure-maa',
            secureBoot: true,
            vmIsolation: 'azure-confidential-vm',
            measurementSummary: 'approved-vtpm-measurement',
          },
        }),
      },
    },
  );
  const productionPayload = await productionHealth.json();
  if (productionPayload?.production_ready !== true) {
    throw new Error(`Expected production health profile to be ready, got ${JSON.stringify(productionPayload)}`);
  }
  if (productionPayload?.security_profile !== 'azure-confidential-production') {
    throw new Error('Expected production health profile to identify Azure confidential production');
  }

  const gcpProductionHealth = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/health'),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: null,
        }),
      },
      enterpriseCloudProvider: 'gcp',
      executorMode: 'confidential',
      gcpProjectId: 'vaultproof-prod',
      gcpLocation: 'us-central1',
      gcpKmsKeyRing: 'vaultproof-runtime',
      gcpKmsKeyName: 'vaultproof-unwrap',
      gcpKmsKeyVersion: '1',
      gcpKmsProtectionLevel: 'SOFTWARE',
      gcpKmsEncryptedVaultUnwrapKeyBase64: 'kms-ciphertext',
      keyProvider: {
        mode: 'gcp-cloud-kms',
        hardwareBound: false,
        getVaultUnwrapKey: async () => 'unused-in-health-smoke',
        getAttestationEvidence: async () => ({
          provider: 'gcp-confidential-vm',
          projectId: 'vaultproof-prod',
          location: 'us-central1',
          attestationTokenHash: 'gcp-attestation-token-sha256',
          keyId: 'projects/vaultproof-prod/locations/us-central1/keyRings/vaultproof-runtime/cryptoKeys/vaultproof-unwrap',
          keyVersion: '1',
          keyProtectionLevel: 'SOFTWARE',
          executorBuildDigest: 'sha256:gcp-executor-build',
          confidentialVmResourceId: 'projects/vaultproof-prod/zones/us-central1-a/instances/vaultproof-enterprise-runtime-1',
          claims: {
            attestationType: 'google-cloud-attestation',
            secureBoot: true,
            vmIsolation: 'gcp-confidential-vm',
            measurementSummary: 'sev-snp;secureboot:true',
            imageDigest: 'sha256:gcp-executor-build',
            serviceAccountEmail: 'vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com',
          },
        }),
      },
    },
  );
  const gcpProductionPayload = await gcpProductionHealth.json();
  if (gcpProductionPayload?.production_ready !== true) {
    throw new Error(`Expected GCP production health profile to be ready, got ${JSON.stringify(gcpProductionPayload)}`);
  }
  if (gcpProductionPayload?.security_profile !== 'google-confidential-production') {
    throw new Error('Expected production health profile to identify Google confidential production');
  }

  const staticTokenHealth = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/health'),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: null,
        }),
      },
      executorMode: 'confidential',
      azureKeyReleaseUrl: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/key-version-1/release',
      azureAttestationToken: 'static-debug-token',
      azureAttestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
      keyProvider: {
        mode: 'azure-secure-key-release',
        hardwareBound: true,
        getVaultUnwrapKey: async () => 'unused-in-health-smoke',
        getAttestationEvidence: async () => ({
          provider: 'azure-confidential-vm',
          attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
          attestationTokenHash: 'attestation-token-sha256',
          keyReleasePolicyHash: 'release-policy-sha256',
          keyId: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap',
          keyVersion: 'key-version-1',
          executorBuildDigest: 'sha256:executor-build',
          confidentialVmResourceId: '/subscriptions/test/resourceGroups/vaultproof-enterprise/providers/Microsoft.Compute/virtualMachines/vpent-executor-cvm',
          claims: {
            attestationType: 'azure-maa',
            secureBoot: true,
            vmIsolation: 'azure-confidential-vm',
            measurementSummary: 'approved-vtpm-measurement',
          },
        }),
      },
    },
  );
  const staticTokenPayload = await staticTokenHealth.json();
  if (staticTokenPayload?.production_ready !== false) {
    throw new Error('Expected static attestation token health profile to be blocked for production');
  }
  if (!staticTokenPayload?.production_blockers?.includes('dynamic Azure guest attestation is not configured')) {
    throw new Error('Expected static token profile to require dynamic Azure guest attestation');
  }
  if (!staticTokenPayload?.production_blockers?.includes('static Azure attestation token is configured')) {
    throw new Error('Expected static token profile to block production readiness');
  }

  const incompleteEvidenceHealth = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/health'),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
      materialResolver: {
        resolveExecutionMaterial: async () => ({
          apiKey: 'sk-enterprise-smoke',
          upstreamBaseUrl: 'https://api.openai.com',
          authHeaderName: 'authorization',
          authHeaderTemplate: 'Bearer {key}',
          extraHeaders: null,
        }),
      },
      executorMode: 'confidential',
      azureKeyReleaseUrl: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/key-version-1/release',
      azureAttestationClientPath: '/usr/local/bin/AttestationClient',
      azureAttestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
      keyProvider: {
        mode: 'azure-secure-key-release',
        hardwareBound: true,
        getVaultUnwrapKey: async () => 'unused-in-health-smoke',
        getAttestationEvidence: async () => ({
          provider: 'azure-confidential-vm',
          attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
          attestationTokenHash: 'attestation-token-sha256',
          keyReleasePolicyHash: null,
          keyId: null,
          keyVersion: null,
          executorBuildDigest: null,
          confidentialVmResourceId: null,
          claims: {
            attestationType: 'azure-maa',
            secureBoot: true,
            vmIsolation: 'azure-confidential-vm',
            measurementSummary: null,
          },
        }),
      },
    },
  );
  const incompleteEvidencePayload = await incompleteEvidenceHealth.json();
  if (incompleteEvidencePayload?.production_ready !== false) {
    throw new Error('Expected incomplete evidence health profile to be blocked for production');
  }
  if (!incompleteEvidencePayload?.production_blockers?.includes('key release policy hash is missing')) {
    throw new Error('Expected incomplete evidence profile to require key release policy hash');
  }
}

async function assertDemoSeedRouteRequiresExplicitOptIn() {
  const closedResponse = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/admin/seed-openai-demo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vaultproof-seed-token': 'seed-token',
      },
      body: JSON.stringify({ project_id: 'proj_123' }),
    }),
    {
      vaultEncryptionKey: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    },
  );
  if (closedResponse.status !== 404) {
    throw new Error(`Expected removed demo seed route to return 404, got ${closedResponse.status}`);
  }

  const confidentialResponse = await handleEnterpriseSecureExecutorRequestWithEnv(
    new Request('http://localhost/admin/seed-openai-demo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vaultproof-seed-token': 'seed-token',
      },
      body: JSON.stringify({ project_id: 'proj_123' }),
    }),
    {
      executorMode: 'confidential',
      keyProvider: {
        mode: 'azure-secure-key-release',
        hardwareBound: true,
        getVaultUnwrapKey: async () => 'unused',
        getAttestationEvidence: async () => null,
      },
    },
  );
  if (confidentialResponse.status !== 404) {
    throw new Error(`Expected removed demo seed route to stay 404 in confidential mode, got ${confidentialResponse.status}`);
  }
}

function makeJwsPayload(payload) {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.signature`;
}

function makeReleasedRsaJwk() {
  return {
    kty: 'RSA-HSM',
    n: 'rsa-modulus',
    e: 'AQAB',
    d: 'rsa-private-exponent',
    p: 'rsa-prime-p',
    q: 'rsa-prime-q',
    dp: 'rsa-dp',
    dq: 'rsa-dq',
    qi: 'rsa-qi',
  };
}

async function expectedAesRootFromReleasedRsaJwk(jwk) {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(jwk)
        .filter(([, value]) => typeof value === 'string')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`vaultproof-enterprise-rsa-hsm-release-root-v1\0${canonical}`),
  );
  return Buffer.from(digest).toString('base64');
}

async function assertAzureSecureKeyReleaseProvider() {
  const releasedRsaJwk = makeReleasedRsaJwk();
  const expectedKey = await expectedAesRootFromReleasedRsaJwk(releasedRsaJwk);
  let releaseCallCount = 0;
  const provider = new AzureSecureKeyReleaseProvider({
    keyReleaseUrl: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/version-1/release',
    attestationToken: 'maa-attestation-token',
    accessToken: 'managed-identity-access-token',
    cacheTtlMs: 25,
    fetchImpl: async (input, init) => {
      releaseCallCount += 1;
      const url = input instanceof URL ? input : new URL(String(input));
      if (!url.toString().includes('api-version=2025-07-01')) {
        throw new Error('Expected Key Vault release API version to be added');
      }
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== 'Bearer managed-identity-access-token') {
        throw new Error('Expected managed identity bearer token');
      }
      const body = JSON.parse(init?.body || '{}');
      if (body.target !== 'maa-attestation-token') {
        throw new Error('Expected MAA attestation token as release target');
      }
      return new Response(JSON.stringify({
        value: makeJwsPayload(releasedRsaJwk),
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    },
  });

  const released = await provider.getVaultUnwrapKey();
  if (released !== expectedKey) {
    throw new Error('Expected released RSA-HSM root to derive the AES-256 unwrap key');
  }
  const cached = await provider.getVaultUnwrapKey();
  if (cached !== expectedKey || releaseCallCount !== 1) {
    throw new Error('Expected released unwrap material to be cached in memory before TTL expiry');
  }
  await new Promise((resolve) => setTimeout(resolve, 35));
  const refreshed = await provider.getVaultUnwrapKey();
  if (refreshed !== expectedKey || releaseCallCount !== 2) {
    throw new Error('Expected released unwrap material to be refreshed after TTL expiry');
  }

  const evidence = await provider.getAttestationEvidence();
  if (evidence?.provider !== 'azure-confidential-vm') {
    throw new Error('Expected Azure attestation evidence from SKR provider');
  }
}

async function assertAzureSecureKeyReleaseProviderCanGenerateAttestationToken() {
  const tempDir = await mkdtemp(join(tmpdir(), 'vaultproof-attestation-smoke-'));
  const attestationToken = makeJwsPayload({
    exp: Math.floor(Date.now() / 1000) + 3600,
    'x-ms-attestation-type': 'sevsnpvm',
  });
  const clientPath = join(tempDir, 'AttestationClient');
  await writeFile(clientPath, `#!/usr/bin/env bash\necho "${attestationToken}"\n`);
  await chmod(clientPath, 0o700);

  try {
    const releasedRsaJwk = {
      ...makeReleasedRsaJwk(),
      d: 'rsa-private-exponent-2',
    };
    const expectedKey = await expectedAesRootFromReleasedRsaJwk(releasedRsaJwk);
    const provider = new AzureSecureKeyReleaseProvider({
      keyReleaseUrl: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/version-2/release',
      attestationClientPath: clientPath,
      attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
      accessToken: 'managed-identity-access-token',
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(init?.body || '{}');
        if (body.target !== attestationToken) {
          throw new Error('Expected generated MAA attestation token as release target');
        }
        return new Response(JSON.stringify({
          value: makeJwsPayload(releasedRsaJwk),
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      },
    });

    const released = await provider.getVaultUnwrapKey();
    if (released !== expectedKey) {
      throw new Error('Expected generated-attestation RSA-HSM root to derive the AES-256 unwrap key');
    }

    const evidence = await provider.getAttestationEvidence();
    if (evidence?.attestationTokenHash !== Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attestationToken))).toString('base64url')) {
      throw new Error('Expected generated attestation token hash to be included in evidence');
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertGcpKmsVaultUnwrapKeyProvider() {
  const expectedKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
  let decryptCallCount = 0;
  const provider = new GcpKmsVaultUnwrapKeyProvider({
    projectId: 'vaultproof-prod',
    location: 'us-central1',
    keyRing: 'vaultproof-runtime',
    keyName: 'vaultproof-unwrap',
    keyVersion: '1',
    keyProtectionLevel: 'SOFTWARE',
    encryptedVaultUnwrapKeyBase64: 'kms-ciphertext',
    accessToken: 'gcp-access-token',
    cacheTtlMs: 25,
    fetchImpl: async (input, init) => {
      decryptCallCount += 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== 'https://cloudkms.googleapis.com/v1/projects/vaultproof-prod/locations/us-central1/keyRings/vaultproof-runtime/cryptoKeys/vaultproof-unwrap:decrypt') {
        throw new Error(`Unexpected GCP KMS decrypt URL: ${url}`);
      }
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== 'Bearer gcp-access-token') {
        throw new Error('Expected GCP access token bearer header');
      }
      const body = JSON.parse(init?.body || '{}');
      if (body.ciphertext !== 'kms-ciphertext') {
        throw new Error('Expected encrypted unwrap key ciphertext to be sent to KMS');
      }
      return new Response(JSON.stringify({ plaintext: expectedKey }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    },
    attestationTokenHash: 'gcp-attestation-token-sha256',
    executorBuildDigest: 'sha256:gcp-executor-build',
    confidentialVmResourceId: 'projects/vaultproof-prod/zones/us-central1-a/instances/vaultproof-enterprise-runtime-1',
    measurementSummary: 'sev-snp;secureboot:true',
    secureBoot: true,
    imageDigest: 'sha256:gcp-executor-build',
    serviceAccountEmail: 'vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com',
  });

  const released = await provider.getVaultUnwrapKey();
  if (released !== expectedKey) {
    throw new Error('Expected GCP KMS decrypt plaintext to become the AES-256 unwrap key');
  }
  const cached = await provider.getVaultUnwrapKey();
  if (cached !== expectedKey || decryptCallCount !== 1) {
    throw new Error('Expected GCP KMS unwrap material to be cached in memory before TTL expiry');
  }
  await new Promise((resolve) => setTimeout(resolve, 35));
  const refreshed = await provider.getVaultUnwrapKey();
  if (refreshed !== expectedKey || decryptCallCount !== 2) {
    throw new Error('Expected GCP KMS unwrap material to be refreshed after TTL expiry');
  }

  const evidence = await provider.getAttestationEvidence();
  if (evidence?.provider !== 'gcp-confidential-vm') {
    throw new Error('Expected GCP confidential VM attestation evidence from KMS provider');
  }
  if (evidence?.keyProtectionLevel !== 'SOFTWARE') {
    throw new Error('Expected GCP KMS software protection level in evidence');
  }
}

async function assertInvalidEnvelope() {
  const envelope = await buildSignedSecureExecutionEnvelope({
    keyId: SIGNING_KEY_ID,
    secret: SIGNING_SECRET,
    request: {
      requestId: 'req_smoke_002',
      projectId: 'proj_123',
      projectKeyId: 'pk_123',
      organizationId: 'org_123',
      provider: 'openai',
      slug: 'primary',
      method: 'POST',
      upstreamPath: '/v1/responses',
      query: '',
      headers: {},
      bodyBase64: null,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: 'nonce-smoke-002',
    },
  });

  envelope.signature = 'tampered-signature';

  const response = await handleEnterpriseSecureExecutorRequestWithEnv(
    makeRequest(envelope),
    {
      acceptedSigningKeys: {
        [SIGNING_KEY_ID]: SIGNING_SECRET,
      },
    },
  );

  if (response.status !== 401) {
    throw new Error(`Expected 401 for invalid signature, got ${response.status}`);
  }
}

await assertValidEnvelope();
await assertReplayBlocked();
await assertHealthReadinessProfiles();
await assertDemoSeedRouteRequiresExplicitOptIn();
await assertAzureSecureKeyReleaseProvider();
await assertAzureSecureKeyReleaseProviderCanGenerateAttestationToken();
await assertGcpKmsVaultUnwrapKeyProvider();
await assertInvalidEnvelope();
console.log('enterprise secure executor smoke test passed');
