import {
  verifySignedSecureExecutionEnvelope,
  isExpiredExecutionRequest,
  type SecureExecutionResult,
  type SignedSecureExecutionEnvelope,
  type AwsSecureExecutionAttestationEvidence,
  type GcpSecureExecutionAttestationEvidence,
  type SecureExecutionAttestationEvidence,
} from '@vaultproof/core';
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

export interface EnterpriseSecureExecutorEnv {
  acceptedSigningKeys?: Record<string, string>;
  materialResolver?: EnterpriseExecutionMaterialResolver;
  resultRecorder?: EnterpriseExecutionResultRecorder;
  fetchImpl?: typeof fetch;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  vaultEncryptionKey?: string;
  enterpriseCloudProvider?: string;
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
  gcpProjectId?: string;
  gcpLocation?: string;
  gcpKmsKeyRing?: string;
  gcpKmsKeyName?: string;
  gcpKmsCryptoKeyResource?: string;
  gcpKmsKeyVersion?: string;
  gcpKmsProtectionLevel?: string;
  gcpKmsEncryptedVaultUnwrapKeyBase64?: string;
  gcpKmsAccessToken?: string;
  gcpKmsCacheTtlMs?: number;
  gcpAttestationTokenHash?: string;
  gcpAttestationToken?: string;
  gcpConfidentialVmResourceId?: string;
  gcpMeasurementSummary?: string;
  gcpSecureBoot?: boolean;
  gcpImageDigest?: string;
  gcpServiceAccountEmail?: string;
  gcpAttestationType?: string;
  gcpIsolationProvider?: 'gcp-confidential-vm' | 'gcp-confidential-space';
  awsRegion?: string;
  awsKmsKeyId?: string;
  awsKmsKeyArn?: string;
  awsKmsKeyVersion?: string;
  awsKmsKeySpec?: string;
  awsKmsKeyUsage?: string;
  awsKmsKeyState?: string;
  awsKmsKeyOrigin?: string;
  awsKmsEncryptedVaultUnwrapKeyBase64?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  awsKmsCacheTtlMs?: number;
  awsAttestationTokenHash?: string;
  awsAttestationToken?: string;
  awsConfidentialVmResourceId?: string;
  awsMeasurementSummary?: string;
  awsSecureBoot?: boolean;
  awsImageDigest?: string;
  awsRoleArn?: string;
  awsAttestationType?: string;
  awsIsolationProvider?: 'aws-nitro-enclave' | 'aws-ec2';
  keyProvider?: VaultUnwrapKeyProvider;
  replayGuard?: ReplayGuard;
}

const defaultReplayGuard = new InMemoryReplayGuard();

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
  attestationEvidence: SecureExecutionAttestationEvidence | null;
  replayProtectionReady: boolean;
  env: EnterpriseSecureExecutorEnv;
}): { ready: boolean; securityProfile: string; blockers: string[] } {
  const cloudProvider = inferCloudProvider(input.env, input.keyProvider);
  if (cloudProvider === 'gcp') {
    return buildGcpProductionReadiness(input);
  }
  if (cloudProvider === 'aws') {
    return buildAwsProductionReadiness(input);
  }

  return buildAzureProductionReadiness(input);
}

function buildAzureProductionReadiness(input: {
  acceptedKeyIds: string[];
  materialResolver: EnterpriseExecutionMaterialResolver;
  keyProvider: VaultUnwrapKeyProvider;
  attestationEvidence: SecureExecutionAttestationEvidence | null;
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
    const evidence = input.attestationEvidence;
    if (evidence.provider !== 'azure-confidential-vm') {
      blockers.push('attestation provider is not Azure Confidential VM');
    }
    const azureEvidence = evidence as Extract<SecureExecutionAttestationEvidence, { provider: 'azure-confidential-vm' }>;
    if (!azureEvidence.attestationProviderUri) {
      blockers.push('attestation provider URI is missing');
    }
    if (!azureEvidence.attestationTokenHash) {
      blockers.push('attestation token hash is missing');
    }
    if (!azureEvidence.keyReleasePolicyHash) {
      blockers.push('key release policy hash is missing');
    }
    if (!azureEvidence.keyId) {
      blockers.push('released key ID is missing');
    }
    if (!azureEvidence.keyVersion) {
      blockers.push('released key version is missing');
    }
    if (!azureEvidence.executorBuildDigest) {
      blockers.push('executor build digest is missing');
    }
    if (!azureEvidence.confidentialVmResourceId) {
      blockers.push('Confidential VM resource ID is missing');
    }
    if (azureEvidence.claims?.attestationType !== 'azure-maa') {
      blockers.push('Azure MAA attestation claim summary is missing');
    }
    if (azureEvidence.claims?.vmIsolation !== 'azure-confidential-vm') {
      blockers.push('Azure Confidential VM isolation claim is missing');
    }
    if (!azureEvidence.claims?.measurementSummary) {
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

function buildGcpProductionReadiness(input: {
  acceptedKeyIds: string[];
  materialResolver: EnterpriseExecutionMaterialResolver;
  keyProvider: VaultUnwrapKeyProvider;
  attestationEvidence: SecureExecutionAttestationEvidence | null;
  replayProtectionReady: boolean;
  env: EnterpriseSecureExecutorEnv;
}): { ready: boolean; securityProfile: string; blockers: string[] } {
  const blockers: string[] = [];
  const executorMode = (input.env.executorMode || 'demo').trim().toLowerCase();
  const hasKmsKeyResource = Boolean(
    input.env.gcpKmsCryptoKeyResource
      || (input.env.gcpProjectId && input.env.gcpLocation && input.env.gcpKmsKeyRing && input.env.gcpKmsKeyName),
  );

  if (input.materialResolver instanceof NullExecutionMaterialResolver) {
    blockers.push('execution material resolver is not configured');
  }
  if (!input.acceptedKeyIds.length) {
    blockers.push('no accepted control-plane signing keys are configured');
  }
  if (input.keyProvider instanceof NullVaultUnwrapKeyProvider) {
    blockers.push('vault unwrap key release is not configured');
  }
  if (input.keyProvider.mode !== 'gcp-cloud-kms') {
    blockers.push(`key release mode is ${input.keyProvider.mode}`);
  }
  if (executorMode !== 'confidential') {
    blockers.push(`executor mode is ${executorMode}`);
  }
  if (!hasKmsKeyResource) {
    blockers.push('GCP Cloud KMS key resource is not configured');
  }
  if (!input.env.gcpKmsEncryptedVaultUnwrapKeyBase64) {
    blockers.push('GCP encrypted vault unwrap key is not configured');
  }

  if (!input.attestationEvidence) {
    blockers.push('GCP attestation evidence is not ready');
  } else {
    const evidence = input.attestationEvidence;
    if (!['gcp-confidential-vm', 'gcp-confidential-space'].includes(evidence.provider)) {
      blockers.push('attestation provider is not GCP Confidential Computing');
    }
    const gcpEvidence = evidence as GcpSecureExecutionAttestationEvidence;
    if (!gcpEvidence.attestationTokenHash) {
      blockers.push('attestation token hash is missing');
    }
    if (!gcpEvidence.keyId) {
      blockers.push('GCP KMS key resource is missing');
    }
    if (!gcpEvidence.keyVersion) {
      blockers.push('GCP KMS key version is missing');
    }
    if (!gcpEvidence.keyProtectionLevel) {
      blockers.push('GCP KMS key protection level is missing');
    }
    if (!gcpEvidence.executorBuildDigest) {
      blockers.push('executor build digest is missing');
    }
    if (!gcpEvidence.confidentialVmResourceId) {
      blockers.push('GCP Confidential VM resource ID is missing');
    }
    if (!gcpEvidence.claims?.attestationType) {
      blockers.push('GCP attestation claim summary is missing');
    }
    if (!gcpEvidence.claims?.vmIsolation) {
      blockers.push('GCP Confidential Computing isolation claim is missing');
    }
    if (!gcpEvidence.claims?.measurementSummary) {
      blockers.push('measurement summary is missing');
    }
  }

  if (!input.replayProtectionReady) {
    blockers.push('replay protection is not ready');
  }

  return {
    ready: blockers.length === 0,
    securityProfile: blockers.length === 0 ? 'google-confidential-production' : 'demo-or-incomplete',
    blockers,
  };
}

function buildAwsProductionReadiness(input: {
  acceptedKeyIds: string[];
  materialResolver: EnterpriseExecutionMaterialResolver;
  keyProvider: VaultUnwrapKeyProvider;
  attestationEvidence: SecureExecutionAttestationEvidence | null;
  replayProtectionReady: boolean;
  env: EnterpriseSecureExecutorEnv;
}): { ready: boolean; securityProfile: string; blockers: string[] } {
  const blockers: string[] = [];
  const executorMode = (input.env.executorMode || 'demo').trim().toLowerCase();
  const hasKmsKey = Boolean(input.env.awsKmsKeyArn || input.env.awsKmsKeyId);

  if (input.materialResolver instanceof NullExecutionMaterialResolver) {
    blockers.push('execution material resolver is not configured');
  }
  if (!input.acceptedKeyIds.length) {
    blockers.push('no accepted control-plane signing keys are configured');
  }
  if (input.keyProvider instanceof NullVaultUnwrapKeyProvider) {
    blockers.push('vault unwrap key release is not configured');
  }
  if (input.keyProvider.mode !== 'aws-kms') {
    blockers.push(`key release mode is ${input.keyProvider.mode}`);
  }
  if (executorMode !== 'confidential') {
    blockers.push(`executor mode is ${executorMode}`);
  }
  if (!input.env.awsRegion && !input.env.awsKmsKeyArn) {
    blockers.push('AWS region is not configured');
  }
  if (!hasKmsKey) {
    blockers.push('AWS KMS key ID or ARN is not configured');
  }
  if (!input.env.awsKmsEncryptedVaultUnwrapKeyBase64) {
    blockers.push('AWS encrypted vault unwrap key is not configured');
  }

  if (!input.attestationEvidence) {
    blockers.push('AWS attestation evidence is not ready');
  } else {
    const evidence = input.attestationEvidence;
    if (!['aws-nitro-enclave', 'aws-ec2'].includes(evidence.provider)) {
      blockers.push('attestation provider is not AWS');
    }
    const awsEvidence = evidence as AwsSecureExecutionAttestationEvidence;
    if (awsEvidence.provider !== 'aws-nitro-enclave') {
      blockers.push('AWS Nitro Enclave isolation evidence is missing');
    }
    if (!awsEvidence.attestationTokenHash) {
      blockers.push('AWS attestation token hash is missing');
    }
    if (!awsEvidence.region) {
      blockers.push('AWS region evidence is missing');
    }
    if (!awsEvidence.keyId && !awsEvidence.keyArn) {
      blockers.push('AWS KMS key evidence is missing');
    }
    if (!awsEvidence.keyState) {
      blockers.push('AWS KMS key state is missing');
    }
    if (!awsEvidence.keySpec) {
      blockers.push('AWS KMS key spec is missing');
    }
    if (!awsEvidence.keyUsage) {
      blockers.push('AWS KMS key usage is missing');
    }
    if (!awsEvidence.executorBuildDigest) {
      blockers.push('executor build digest is missing');
    }
    if (!awsEvidence.confidentialVmResourceId) {
      blockers.push('AWS confidential runtime resource ID is missing');
    }
    if (!awsEvidence.claims?.attestationType) {
      blockers.push('AWS attestation claim summary is missing');
    }
    if (!awsEvidence.claims?.measurementSummary) {
      blockers.push('measurement summary is missing');
    }
  }

  if (!input.replayProtectionReady) {
    blockers.push('replay protection is not ready');
  }

  return {
    ready: blockers.length === 0,
    securityProfile: blockers.length === 0 ? 'aws-kms-confidential-production' : 'demo-or-incomplete',
    blockers,
  };
}

function inferCloudProvider(env: EnterpriseSecureExecutorEnv, keyProvider: VaultUnwrapKeyProvider): 'azure' | 'gcp' | 'aws' {
  const configured = env.enterpriseCloudProvider?.trim().toLowerCase();
  if (configured === 'gcp' || configured === 'google' || configured === 'google-cloud') return 'gcp';
  if (configured === 'aws' || configured === 'amazon' || configured === 'amazon-web-services') return 'aws';
  if (keyProvider.mode === 'gcp-cloud-kms') return 'gcp';
  if (keyProvider.mode === 'aws-kms') return 'aws';
  return 'azure';
}

function summarizeKeyReleaseEvidence(
  evidence: SecureExecutionAttestationEvidence | null,
): Record<string, unknown> | null {
  if (!evidence) return null;
  if (evidence.provider === 'gcp-confidential-vm' || evidence.provider === 'gcp-confidential-space') {
    return {
      provider: evidence.provider,
      project_id: evidence.projectId,
      location: evidence.location,
      key_id: evidence.keyId,
      key_version: evidence.keyVersion,
      key_protection_level: evidence.keyProtectionLevel,
      confidential_vm_resource_id: evidence.confidentialVmResourceId,
      executor_build_digest: evidence.executorBuildDigest,
      attestation_token_hash_present: Boolean(evidence.attestationTokenHash),
      measurement_summary_present: Boolean(evidence.claims?.measurementSummary),
    };
  }
  if (evidence.provider === 'aws-nitro-enclave' || evidence.provider === 'aws-ec2') {
    return {
      provider: evidence.provider,
      region: evidence.region,
      account_id: evidence.accountId,
      key_id: evidence.keyId,
      key_arn: evidence.keyArn,
      key_version: evidence.keyVersion,
      key_spec: evidence.keySpec,
      key_usage: evidence.keyUsage,
      key_state: evidence.keyState,
      key_origin: evidence.keyOrigin,
      confidential_vm_resource_id: evidence.confidentialVmResourceId,
      executor_build_digest: evidence.executorBuildDigest,
      attestation_token_hash_present: Boolean(evidence.attestationTokenHash),
      measurement_summary_present: Boolean(evidence.claims?.measurementSummary),
    };
  }

  return {
    provider: evidence.provider,
    key_id: evidence.keyId,
    key_version: evidence.keyVersion,
    confidential_vm_resource_id: evidence.confidentialVmResourceId,
    executor_build_digest: evidence.executorBuildDigest,
    attestation_token_hash_present: Boolean(evidence.attestationTokenHash),
    measurement_summary_present: Boolean(evidence.claims?.measurementSummary),
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
      key_release_evidence: summarizeKeyReleaseEvidence(attestationEvidence),
      attestation_evidence_ready: Boolean(attestationEvidence),
      replay_protection_ready: true,
      production_ready: productionReadiness.ready,
      security_profile: productionReadiness.securityProfile,
      production_blockers: productionReadiness.blockers,
    });
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
