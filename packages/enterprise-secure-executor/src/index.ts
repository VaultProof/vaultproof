import {
  verifySignedSecureExecutionEnvelope,
  isExpiredExecutionRequest,
  type SecureExecutionResult,
  type SignedSecureExecutionEnvelope,
  type AzureSecureExecutionAttestationEvidence,
} from '@vaultproof/core';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import {
  executeUpstreamRequest,
  type ResolvedSecureExecutionMaterial,
} from './upstream.js';
import {
  NullExecutionMaterialResolver,
  NullExecutionResultRecorder,
  SupabaseExecutionMaterialResolver,
  SupabaseExecutionResultRecorder,
  type EnterpriseExecutionMaterialResolver,
  type EnterpriseExecutionResultRecorder,
} from './material.js';
import {
  buildVaultUnwrapKeyProvider,
  NullVaultUnwrapKeyProvider,
  type VaultUnwrapKeyProvider,
} from './key-release.js';
import { InMemoryReplayGuard, type ReplayGuard } from './replay-guard.js';
import { getSupabase } from './supabase.js';

export interface EnterpriseSecureExecutorEnv {
  acceptedSigningKeys?: Record<string, string>;
  materialResolver?: EnterpriseExecutionMaterialResolver;
  resultRecorder?: EnterpriseExecutionResultRecorder;
  fetchImpl?: typeof fetch;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  vaultEncryptionKey?: string;
  executorMode?: string;
  azureKeyReleaseUrl?: string;
  azureAttestationToken?: string;
  azureAttestationClientPath?: string;
  azureKeyVaultAccessToken?: string;
  azureKeyReleaseEnc?: string;
  azureKeyReleaseCacheTtlMs?: number;
  azureAttestationProviderUri?: string;
  azureAttestationTokenHash?: string;
  azureKeyReleasePolicyHash?: string;
  azureKeyId?: string;
  azureKeyVersion?: string;
  executorBuildDigest?: string;
  azureConfidentialVmResourceId?: string;
  azureMeasurementSummary?: string;
  keyProvider?: VaultUnwrapKeyProvider;
  replayGuard?: ReplayGuard;
  demoSeedToken?: string;
  allowDemoSeedRoute?: boolean;
}

const defaultReplayGuard = new InMemoryReplayGuard();

interface SeedDemoOpenAiBody {
  project_id?: string;
  demo_key?: string;
}

async function parseEnvelope(request: Request): Promise<SignedSecureExecutionEnvelope | null> {
  try {
    return (await request.json()) as SignedSecureExecutionEnvelope;
  } catch {
    return null;
  }
}

function validateEnvelope(envelope: SignedSecureExecutionEnvelope): string | null {
  if (!envelope.keyId || !envelope.signature) return 'Missing signature metadata.';
  if (!envelope.request?.requestId) return 'Missing secure execution request payload.';
  if (!envelope.request?.nonce) return 'Missing secure execution nonce.';
  if (isExpiredExecutionRequest(envelope.request)) return 'Secure execution request has expired.';
  return null;
}

function gf256Mul(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) result ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return result;
}

function serializeShare(share: { x: number; y: Uint8Array }): string {
  const bytes = new Uint8Array(1 + share.y.length);
  bytes[0] = share.x;
  bytes.set(share.y, 1);
  return Buffer.from(bytes).toString('base64');
}

function splitTwoOfTwo(secret: string): [string, string] {
  const secretBytes = new TextEncoder().encode(secret);
  const share1 = { x: 1, y: new Uint8Array(secretBytes.length) };
  const share2 = { x: 2, y: new Uint8Array(secretBytes.length) };

  for (let i = 0; i < secretBytes.length; i++) {
    const slope = randomBytes(1)[0];
    share1.y[i] = secretBytes[i] ^ slope;
    share2.y[i] = secretBytes[i] ^ gf256Mul(slope, 2);
  }

  return [serializeShare(share1), serializeShare(share2)];
}

function getMasterKey(raw: string): Buffer {
  if (!raw) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (raw.length === 64) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'base64');
}

function hkdfSha256(masterKey: Buffer, salt: Buffer, purpose: string): Buffer {
  const prk = createHmac('sha256', salt).update(masterKey).digest();
  const info = Buffer.from(purpose, 'utf8');
  return createHmac('sha256', prk).update(info).update(Buffer.from([0x01])).digest();
}

function encryptShare(shareBase64: string, vaultEncryptionKey: string, purpose: string): string {
  const plaintext = Buffer.from(shareBase64, 'base64');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = hkdfSha256(getMasterKey(vaultEncryptionKey), salt, purpose);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([0x02]), salt, iv, tag, ciphertext]).toString('base64');
}

async function parseSeedBody(request: Request): Promise<SeedDemoOpenAiBody | null> {
  try {
    return (await request.json()) as SeedDemoOpenAiBody;
  } catch {
    return null;
  }
}

async function seedDemoOpenAiKey(request: Request, env: EnterpriseSecureExecutorEnv): Promise<Response> {
  if (!env.allowDemoSeedRoute) {
    return Response.json({ error: 'Not found', service: 'vaultproof-enterprise-secure-executor' }, { status: 404 });
  }

  if ((env.executorMode || 'demo').trim().toLowerCase() === 'confidential') {
    return Response.json({ error: 'Demo seed route is disabled in confidential mode.' }, { status: 404 });
  }

  const providedToken = request.headers.get('x-vaultproof-seed-token') || '';
  if (!env.demoSeedToken || providedToken !== env.demoSeedToken) {
    return Response.json({ error: 'Seed route is not authorized.' }, { status: 404 });
  }

  const keyProvider = buildVaultUnwrapKeyProvider(env);
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey || keyProvider instanceof NullVaultUnwrapKeyProvider) {
    return Response.json({ error: 'Seed route requires Supabase and vault key release.' }, { status: 501 });
  }

  const body = await parseSeedBody(request);
  const projectId = body?.project_id?.trim();
  if (!projectId) {
    return Response.json({ error: 'project_id is required' }, { status: 400 });
  }

  const demoKey = body?.demo_key?.trim() || 'sk-vaultproof-enterprise-demo-invalid-key';
  const [share1, share2] = splitTwoOfTwo(demoKey);
  const vaultEncryptionKey = await keyProvider.getVaultUnwrapKey();
  const share1Encrypted = encryptShare(share1, vaultEncryptionKey, 'vaultproof-enterprise-share1-v1');
  const share2Encrypted = encryptShare(share2, vaultEncryptionKey, 'vaultproof-enterprise-share2-v1');
  const supabase = getSupabase(env);

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError || !project) {
    return Response.json(
      {
        error: 'Demo project not found',
        detail: projectError ? JSON.stringify(projectError) : null,
      },
      { status: 404 },
    );
  }

  const { error: deleteError } = await supabase
    .from('project_keys')
    .delete()
    .eq('project_id', projectId)
    .or('provider.eq.openai,slug.eq.openai');

  if (deleteError) {
    return Response.json(
      {
        error: 'Failed to clear existing demo provider slot',
        detail: JSON.stringify(deleteError),
      },
      { status: 500 },
    );
  }

  const { error } = await supabase
    .from('project_keys')
    .insert({
      project_id: projectId,
      provider: 'openai',
      slug: 'openai',
      env_var: 'OPENAI_API_KEY',
      upstream_base_url: 'https://api.openai.com',
      auth_header_name: 'Authorization',
      auth_header_template: 'Bearer {key}',
      extra_headers: null,
      share1_encrypted: share1Encrypted,
      share2_encrypted: share2Encrypted,
      revoked_at: null,
    });

  if (error) {
    return Response.json({ error: 'Failed to seed demo provider slot', detail: JSON.stringify(error) }, { status: 500 });
  }

  const { data: projectKey, error: lookupError } = await supabase
    .from('project_keys')
    .select('id, project_id, provider, slug')
    .eq('project_id', projectId)
    .eq('provider', 'openai')
    .maybeSingle();

  if (lookupError || !projectKey) {
    return Response.json(
      {
        error: 'Seed completed but project key lookup failed',
        detail: lookupError?.message || null,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, project_key: projectKey }, { status: 201 });
}

function notImplementedResult(envelope: SignedSecureExecutionEnvelope): SecureExecutionResult {
  return {
    requestId: envelope.request.requestId,
    status: 501,
    headers: {},
    bodyBase64: null,
    error: 'Secure execution is not implemented yet.',
  };
}

function buildProductionReadiness(input: {
  acceptedKeyIds: string[];
  materialResolver: EnterpriseExecutionMaterialResolver;
  keyProvider: VaultUnwrapKeyProvider;
  attestationEvidence: AzureSecureExecutionAttestationEvidence | null;
  replayProtectionReady: boolean;
  env: EnterpriseSecureExecutorEnv;
}): { ready: boolean; securityProfile: string; blockers: string[] } {
  const blockers: string[] = [];
  const executorMode = (input.env.executorMode || 'demo').trim().toLowerCase();
  const hasDynamicAttestationSource = Boolean(input.env.azureAttestationClientPath && input.env.azureAttestationProviderUri);

  if (input.materialResolver instanceof NullExecutionMaterialResolver) {
    blockers.push('execution material resolver is not configured');
  }
  if (!input.acceptedKeyIds.length) {
    blockers.push('no accepted control-plane signing keys are configured');
  }
  if (input.keyProvider instanceof NullVaultUnwrapKeyProvider) {
    blockers.push('vault unwrap key release is not configured');
  }
  if (!input.keyProvider.hardwareBound) {
    blockers.push('key release is not hardware-bound');
  }
  if (input.keyProvider.mode !== 'azure-secure-key-release') {
    blockers.push(`key release mode is ${input.keyProvider.mode}`);
  }
  if (executorMode !== 'confidential') {
    blockers.push(`executor mode is ${executorMode}`);
  }
  if (!input.env.azureKeyReleaseUrl) {
    blockers.push('Azure key release URL is not configured');
  }
  if (!hasDynamicAttestationSource) {
    blockers.push('dynamic Azure guest attestation is not configured');
  }
  if (input.env.azureAttestationToken) {
    blockers.push('static Azure attestation token is configured');
  }
  if (!input.attestationEvidence) {
    blockers.push('Azure attestation evidence is not ready');
  } else {
    if (input.attestationEvidence.provider !== 'azure-confidential-vm') {
      blockers.push('attestation provider is not Azure Confidential VM');
    }
    if (!input.attestationEvidence.attestationProviderUri) {
      blockers.push('attestation provider URI is missing');
    }
    if (!input.attestationEvidence.attestationTokenHash) {
      blockers.push('attestation token hash is missing');
    }
    if (!input.attestationEvidence.keyReleasePolicyHash) {
      blockers.push('key release policy hash is missing');
    }
    if (!input.attestationEvidence.keyId) {
      blockers.push('released key ID is missing');
    }
    if (!input.attestationEvidence.keyVersion) {
      blockers.push('released key version is missing');
    }
    if (!input.attestationEvidence.executorBuildDigest) {
      blockers.push('executor build digest is missing');
    }
    if (!input.attestationEvidence.confidentialVmResourceId) {
      blockers.push('Confidential VM resource ID is missing');
    }
    if (input.attestationEvidence.claims?.attestationType !== 'azure-maa') {
      blockers.push('Azure MAA attestation claim summary is missing');
    }
    if (input.attestationEvidence.claims?.vmIsolation !== 'azure-confidential-vm') {
      blockers.push('Azure Confidential VM isolation claim is missing');
    }
    if (!input.attestationEvidence.claims?.measurementSummary) {
      blockers.push('measurement summary is missing');
    }
  }
  if (!input.replayProtectionReady) {
    blockers.push('replay protection is not ready');
  }

  return {
    ready: blockers.length === 0,
    securityProfile: blockers.length === 0 ? 'azure-confidential-production' : 'demo-or-incomplete',
    blockers,
  };
}

async function executeEnvelope(
  envelope: SignedSecureExecutionEnvelope,
  env: EnterpriseSecureExecutorEnv,
): Promise<SecureExecutionResult> {
  const materialResolver = env.materialResolver || new NullExecutionMaterialResolver();
  if (materialResolver instanceof NullExecutionMaterialResolver) {
    return notImplementedResult(envelope);
  }

  const material = await materialResolver.resolveExecutionMaterial(envelope.request);
  if (!material) {
    return {
      requestId: envelope.request.requestId,
      status: 404,
      headers: {},
      bodyBase64: null,
      providerRequestId: null,
      error: 'Secure execution material not found.',
    };
  }

  const result = await executeUpstreamRequest(envelope.request, material, {
    fetchImpl: env.fetchImpl,
  });
  result.attestation = await buildVaultUnwrapKeyProvider(env).getAttestationEvidence();
  const resultRecorder = env.resultRecorder || new NullExecutionResultRecorder();
  await resultRecorder.recordExecutionResult({
    request: envelope.request,
    result,
  });
  return result;
}

export async function handleEnterpriseSecureExecutorRequest(request: Request): Promise<Response> {
  return handleEnterpriseSecureExecutorRequestWithEnv(request, {});
}

export async function handleEnterpriseSecureExecutorRequestWithEnv(
  request: Request,
  env: EnterpriseSecureExecutorEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const acceptedKeyIds = Object.keys(env.acceptedSigningKeys || {});
  const keyProvider = buildVaultUnwrapKeyProvider(env);
  const replayGuard = env.replayGuard || defaultReplayGuard;
  const effectiveMaterialResolver = env.materialResolver
    || (env.supabaseUrl && env.supabaseServiceRoleKey && !(keyProvider instanceof NullVaultUnwrapKeyProvider)
      ? new SupabaseExecutionMaterialResolver({
          supabaseUrl: env.supabaseUrl,
          supabaseServiceRoleKey: env.supabaseServiceRoleKey,
          keyProvider,
        })
      : new NullExecutionMaterialResolver());
  const effectiveResultRecorder = env.resultRecorder
    || (env.supabaseUrl && env.supabaseServiceRoleKey
      ? new SupabaseExecutionResultRecorder({
          supabaseUrl: env.supabaseUrl,
          supabaseServiceRoleKey: env.supabaseServiceRoleKey,
        })
      : new NullExecutionResultRecorder());

  if (request.method === 'GET' && url.pathname === '/health') {
    const attestationEvidence = await keyProvider.getAttestationEvidence();
    const productionReadiness = buildProductionReadiness({
      acceptedKeyIds,
      materialResolver: effectiveMaterialResolver,
      keyProvider,
      attestationEvidence,
      replayProtectionReady: true,
      env,
    });

    return Response.json({
      status: 'ok',
      service: 'vaultproof-enterprise-secure-executor',
      secure_execution_ready: !(effectiveMaterialResolver instanceof NullExecutionMaterialResolver),
      signature_verification_ready: acceptedKeyIds.length > 0,
      accepted_key_ids: acceptedKeyIds,
      execution_material_resolver_ready: !(effectiveMaterialResolver instanceof NullExecutionMaterialResolver),
      key_release_ready: !(keyProvider instanceof NullVaultUnwrapKeyProvider),
      key_release_mode: keyProvider.mode,
      key_release_hardware_bound: keyProvider.hardwareBound,
      attestation_evidence_ready: Boolean(attestationEvidence),
      replay_protection_ready: true,
      production_ready: productionReadiness.ready,
      security_profile: productionReadiness.securityProfile,
      production_blockers: productionReadiness.blockers,
    });
  }

  if (request.method === 'POST' && url.pathname === '/admin/seed-openai-demo') {
    return seedDemoOpenAiKey(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/execute') {
    const envelope = await parseEnvelope(request);
    if (!envelope) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validationError = validateEnvelope(envelope);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const signingSecret = env.acceptedSigningKeys?.[envelope.keyId];
    if (!signingSecret) {
      return Response.json({ error: 'Unknown secure execution signing key.' }, { status: 401 });
    }

    const verified = await verifySignedSecureExecutionEnvelope(envelope, signingSecret);
    if (!verified) {
      return Response.json({ error: 'Invalid secure execution signature.' }, { status: 401 });
    }

    const notReplayed = await replayGuard.consume(envelope.request);
    if (!notReplayed) {
      return Response.json({ error: 'Secure execution request was already consumed.' }, { status: 409 });
    }

    const result = await executeEnvelope(envelope, {
      ...env,
      materialResolver: effectiveMaterialResolver,
      resultRecorder: effectiveResultRecorder,
    });
    return Response.json(result, { status: result.status });
  }

  return Response.json(
    {
      error: 'Not found',
      service: 'vaultproof-enterprise-secure-executor',
    },
    { status: 404 },
  );
}
