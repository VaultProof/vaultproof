import type { EnterpriseControlPlaneEnv } from '../config.js';
import { getEnterpriseRuntimeTier } from '../config.js';
import {
  authenticateUser,
  getAccessibleProject,
  hasRequiredProjectRole,
  listAccessibleProjects,
  resolveOrganizationMembership,
} from '../auth.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import { getSupabase } from '../supabase.js';

const SUPPORTED_PROOF_SYSTEMS = [
  'vaultproof-manifest-v1',
  'world-zk-compute',
  'ezkl',
  'risc0',
  'tee-attestation',
  'external-verifier',
] as const;

const SUPPORTED_MODEL_FAMILIES = [
  'classification',
  'regression',
  'ranking',
  'embedding',
  'llm',
  'vision',
  'custom',
] as const;

const SHARED_ATTESTATION_MODE = 'shared-enterprise-runtime-attestation';

type ProofSystem = typeof SUPPORTED_PROOF_SYSTEMS[number];
type ModelFamily = typeof SUPPORTED_MODEL_FAMILIES[number];
type VerificationStatus = 'verified' | 'recorded' | 'failed';

interface VerifierModelBody {
  project_id?: string | null;
  model_ref?: string | null;
  display_name?: string | null;
  model_family?: string | null;
  allowed_proof_systems?: unknown;
  status?: string | null;
  metadata?: unknown;
}

interface ProofVerificationBody {
  project_id?: string | null;
  model_id?: string | null;
  model_ref?: string | null;
  proof_system?: string | null;
  verifier_version?: string | null;
  proof_bundle?: unknown;
  proof_bundle_hash?: string | null;
  public_input_hash?: string | null;
  claimed_output_hash?: string | null;
  external_job_id?: string | null;
  attestation_evidence?: unknown;
  evidence?: unknown;
}

interface VerifierModelRow {
  id: string;
  organization_id: string;
  project_id: string;
  model_ref: string;
  display_name: string;
  model_family: ModelFamily;
  allowed_proof_systems: ProofSystem[];
  status: 'enabled' | 'disabled' | 'planned';
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProofVerificationRow {
  id: string;
  organization_id: string;
  project_id: string;
  model_id: string;
  model_ref: string;
  proof_system: ProofSystem;
  verifier_version: string;
  status: VerificationStatus;
  proof_hash: string;
  public_input_hash: string | null;
  claimed_output_hash: string | null;
  external_job_id: string | null;
  failure_reason: string | null;
  evidence: Record<string, unknown>;
  submitted_by: string | null;
  submitted_email: string | null;
  created_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonBody<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return request.json()
    .then((value) => ({ ok: true, value: value as T }) as const)
    .catch(() => ({ ok: false, error: 'Invalid JSON' }) as const);
}

function normalizeId(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(normalized)) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: normalized };
}

function normalizeModelRef(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._:-]{1,126}[a-z0-9]$/.test(normalized)) {
    return { ok: false, error: 'model_ref must be a stable lowercase ID such as fraud-xgb-v1' };
  }
  return { ok: true, value: normalized };
}

function normalizeDisplayName(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 140) : '';
  return normalized || fallback;
}

function normalizeModelFamily(value: unknown): ModelFamily {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (SUPPORTED_MODEL_FAMILIES as readonly string[]).includes(normalized)
    ? normalized as ModelFamily
    : 'custom';
}

function normalizeStatus(value: unknown): 'enabled' | 'disabled' | 'planned' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'disabled' || normalized === 'planned') return normalized;
  return 'enabled';
}

function normalizeProofSystem(value: unknown): ProofSystem | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (SUPPORTED_PROOF_SYSTEMS as readonly string[]).includes(normalized)
    ? normalized as ProofSystem
    : null;
}

function normalizeProofSystems(value: unknown): ProofSystem[] {
  const input = Array.isArray(value) ? value : ['vaultproof-manifest-v1'];
  const normalized = input
    .map(normalizeProofSystem)
    .filter(Boolean) as ProofSystem[];
  return [...new Set(normalized)].length
    ? [...new Set(normalized)]
    : ['vaultproof-manifest-v1'];
}

function normalizeHash(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (/^sha256:[a-f0-9]{64}$/i.test(normalized)) return `sha256:${normalized.slice(7).toLowerCase()}`;
  if (/^sha256:[A-Za-z0-9_-]{32,96}$/.test(normalized)) return normalized;
  if (/^[a-f0-9]{64}$/i.test(normalized)) return `sha256:${normalized.toLowerCase()}`;
  if (/^[A-Za-z0-9_-]{32,96}$/.test(normalized)) return `sha256:${normalized}`;
  return null;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const metadata: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) continue;
    if (typeof item === 'string') metadata[key] = item.slice(0, 500);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) metadata[key] = item;
    else if (Array.isArray(item)) metadata[key] = item.slice(0, 20).map((entry) => String(entry).slice(0, 120));
  }
  return metadata;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashJson(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value)));
  return `sha256:${Buffer.from(digest).toString('base64url')}`;
}

function isMissingVerifierTable(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('organization_verifier_models')
    || message.includes('organization_proof_verifications')
    || message.includes('schema cache');
}

function verificationEventType(status: VerificationStatus): string {
  if (status === 'verified') return 'enterprise_ai_proof_verified';
  if (status === 'failed') return 'enterprise_ai_proof_failed';
  return 'enterprise_ai_proof_recorded';
}

function sharedDemoAttestation(env: EnterpriseControlPlaneEnv): Record<string, unknown> {
  const runtimeTier = getEnterpriseRuntimeTier(env);
  return {
    mode: SHARED_ATTESTATION_MODE,
    label: 'Shared enterprise runtime attestation',
    runtime_tier: runtimeTier,
    customer_dedicated_runtime: runtimeTier === 'dedicated-production',
    source: '/readiness',
    attestation_provider: 'microsoft-azure-attestation',
    dynamic_guest_attestation_required: true,
    static_attestation_token_allowed: false,
    model_execution_hosted_by_vaultproof: false,
    enterprise_host: env.enterpriseHostname || null,
    executor_configured: Boolean(env.executorBaseUrl),
    azure_front_door_configured: Boolean(env.azureFrontDoorId),
    origin_lock_required: env.originLockRequired === true,
  };
}

function evaluateProofBundle(input: {
  proofSystem: ProofSystem;
  model: VerifierModelRow;
  projectId: string;
  proofBundle: unknown;
  proofHash: string;
  providedProofHash: string | null;
  claimedOutputHash: string | null;
}): { status: VerificationStatus; failureReason: string | null; evidence: Record<string, unknown> } {
  const evidence: Record<string, unknown> = {
    verifier_mode: 'verifier-first',
    proof_system: input.proofSystem,
    local_adapter: input.proofSystem === 'vaultproof-manifest-v1' ? 'manifest-integrity' : 'external-record',
    model_execution_hosted_by_vaultproof: false,
  };

  if (input.providedProofHash && input.providedProofHash !== input.proofHash) {
    return {
      status: 'failed',
      failureReason: 'Provided proof_bundle_hash does not match the submitted proof bundle.',
      evidence: { ...evidence, hash_match: false },
    };
  }

  if (input.proofSystem !== 'vaultproof-manifest-v1') {
    return {
      status: 'recorded',
      failureReason: null,
      evidence: {
        ...evidence,
        hash_match: Boolean(input.providedProofHash),
        note: 'Proof bundle recorded. Cryptographic adapter for this proof system is not enabled yet.',
      },
    };
  }

  if (!isRecord(input.proofBundle)) {
    return {
      status: 'failed',
      failureReason: 'vaultproof-manifest-v1 requires proof_bundle to be an object.',
      evidence,
    };
  }

  const bundleModelRef = typeof input.proofBundle.model_ref === 'string' ? input.proofBundle.model_ref.trim().toLowerCase() : '';
  const bundleProjectId = typeof input.proofBundle.project_id === 'string' ? input.proofBundle.project_id.trim() : '';
  const bundleProofSystem = typeof input.proofBundle.proof_system === 'string' ? input.proofBundle.proof_system.trim().toLowerCase() : '';
  const bundleOutputHash = normalizeHash(input.proofBundle.claimed_output_hash || input.proofBundle.output_hash);
  const failures = [
    bundleModelRef && bundleModelRef !== input.model.model_ref ? 'proof bundle model_ref does not match the registered model' : null,
    bundleProjectId && bundleProjectId !== input.projectId ? 'proof bundle project_id does not match the submitted project' : null,
    bundleProofSystem && bundleProofSystem !== input.proofSystem ? 'proof bundle proof_system does not match the submitted proof system' : null,
    input.claimedOutputHash && bundleOutputHash && bundleOutputHash !== input.claimedOutputHash ? 'proof bundle output hash does not match claimed_output_hash' : null,
  ].filter(Boolean);

  if (failures.length) {
    return {
      status: 'failed',
      failureReason: failures.join('; '),
      evidence: {
        ...evidence,
        manifest_checked: true,
        manifest_valid: false,
      },
    };
  }

  return {
    status: 'verified',
    failureReason: null,
    evidence: {
      ...evidence,
      manifest_checked: true,
      manifest_valid: true,
      hash_match: Boolean(input.providedProofHash),
    },
  };
}

export async function handleEnterpriseVerifierRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  if (pathSegments[0] !== 'verifier') return null;

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
      { status: 401 },
    );
  }

  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  if (!membership) {
    return Response.json({
      organization: null,
      schema_ready: true,
      projects: [],
      models: [],
      verifications: [],
      proof_systems: SUPPORTED_PROOF_SYSTEMS,
      model_families: SUPPORTED_MODEL_FAMILIES,
      shared_attestation: sharedDemoAttestation(env),
    });
  }

  const supabase = getSupabase(env);

  if (request.method === 'GET' && pathSegments.length === 1) {
    const projects = await listAccessibleProjects(env, auth.userId, membership.organization_id);
    const projectIds = projects.map((project) => project.id);
    if (!projectIds.length) {
      return Response.json({
        organization: {
          id: membership.organization_id,
          name: membership.organization_name,
          role: membership.organization_role,
        },
        schema_ready: true,
        projects: [],
        models: [],
        verifications: [],
        proof_systems: SUPPORTED_PROOF_SYSTEMS,
        model_families: SUPPORTED_MODEL_FAMILIES,
        shared_attestation: sharedDemoAttestation(env),
      });
    }

    const [{ data: modelRows, error: modelError }, { data: verificationRows, error: verificationError }] = await Promise.all([
      supabase
        .from('organization_verifier_models')
        .select('*')
        .eq('organization_id', membership.organization_id)
        .in('project_id', projectIds)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('organization_proof_verifications')
        .select('*')
        .eq('organization_id', membership.organization_id)
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (isMissingVerifierTable(modelError) || isMissingVerifierTable(verificationError)) {
      return Response.json({
        organization: {
          id: membership.organization_id,
          name: membership.organization_name,
          role: membership.organization_role,
        },
        schema_ready: false,
        migration_required: 'Apply supabase/migrations/20260430010000_enterprise_ai_proof_verifier.sql',
        projects,
        models: [],
        verifications: [],
        proof_systems: SUPPORTED_PROOF_SYSTEMS,
        model_families: SUPPORTED_MODEL_FAMILIES,
        shared_attestation: sharedDemoAttestation(env),
      });
    }

    return Response.json({
      organization: {
        id: membership.organization_id,
        name: membership.organization_name,
        role: membership.organization_role,
      },
      schema_ready: true,
      projects,
      models: modelRows || [],
      verifications: verificationRows || [],
      proof_systems: SUPPORTED_PROOF_SYSTEMS,
      model_families: SUPPORTED_MODEL_FAMILIES,
      shared_attestation: sharedDemoAttestation(env),
    });
  }

  if (request.method === 'POST' && pathSegments.length === 2 && pathSegments[1] === 'models') {
    const parsed = await parseJsonBody<VerifierModelBody>(request);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

    const projectId = normalizeId(parsed.value.project_id, 'project_id');
    if (!projectId.ok) return Response.json({ error: projectId.error }, { status: 400 });
    const project = await getAccessibleProject(env, auth.userId, projectId.value);
    if (!project || project.organization_id !== membership.organization_id) {
      return Response.json({ error: 'Project not found or not accessible.' }, { status: 404 });
    }
    if (!hasRequiredProjectRole(project.project_role, 'project_admin')) {
      return Response.json({ error: 'Project admin access is required to register verifier models.' }, { status: 403 });
    }

    const modelRef = normalizeModelRef(parsed.value.model_ref);
    if (!modelRef.ok) return Response.json({ error: modelRef.error }, { status: 400 });
    const allowedProofSystems = normalizeProofSystems(parsed.value.allowed_proof_systems);
    const row = {
      organization_id: membership.organization_id,
      project_id: project.id,
      model_ref: modelRef.value,
      display_name: normalizeDisplayName(parsed.value.display_name, modelRef.value),
      model_family: normalizeModelFamily(parsed.value.model_family),
      allowed_proof_systems: allowedProofSystems,
      status: normalizeStatus(parsed.value.status),
      metadata: safeMetadata(parsed.value.metadata),
      created_by: auth.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('organization_verifier_models')
      .upsert(row, { onConflict: 'organization_id,project_id,model_ref' })
      .select('*')
      .single();

    if (isMissingVerifierTable(error)) {
      return Response.json({ error: 'AI Proof Verifier tables are not deployed yet.' }, { status: 503 });
    }
    if (error || !data) {
      return Response.json({ error: error?.message || 'Failed to save verifier model.' }, { status: 500 });
    }

    const model = data as VerifierModelRow;
    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      project_id: project.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'enterprise_ai_verifier_model_registered',
      target_type: 'verifier_model',
      target_id: model.id,
      description: `Registered AI proof verifier model ${model.model_ref}`,
      metadata: {
        model_ref: model.model_ref,
        model_family: model.model_family,
        allowed_proof_systems: model.allowed_proof_systems,
        verifier_first: true,
        model_execution_hosted_by_vaultproof: false,
        shared_attestation_mode: SHARED_ATTESTATION_MODE,
      },
    });

    return Response.json({ model });
  }

  if (request.method === 'POST' && pathSegments.length === 2 && pathSegments[1] === 'proofs') {
    const parsed = await parseJsonBody<ProofVerificationBody>(request);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

    const projectId = normalizeId(parsed.value.project_id, 'project_id');
    if (!projectId.ok) return Response.json({ error: projectId.error }, { status: 400 });
    const project = await getAccessibleProject(env, auth.userId, projectId.value);
    if (!project || project.organization_id !== membership.organization_id) {
      return Response.json({ error: 'Project not found or not accessible.' }, { status: 404 });
    }
    if (!hasRequiredProjectRole(project.project_role, 'developer')) {
      return Response.json({ error: 'Project developer/operator access is required to submit proof evidence.' }, { status: 403 });
    }

    const proofSystem = normalizeProofSystem(parsed.value.proof_system);
    if (!proofSystem) return Response.json({ error: 'Unsupported proof_system.' }, { status: 400 });

    let modelQuery = supabase
      .from('organization_verifier_models')
      .select('*')
      .eq('organization_id', membership.organization_id)
      .eq('project_id', project.id)
      .limit(1);
    if (parsed.value.model_id) modelQuery = modelQuery.eq('id', String(parsed.value.model_id).trim());
    else {
      const modelRef = normalizeModelRef(parsed.value.model_ref);
      if (!modelRef.ok) return Response.json({ error: 'model_id or model_ref is required.' }, { status: 400 });
      modelQuery = modelQuery.eq('model_ref', modelRef.value);
    }

    const { data: modelRows, error: modelError } = await modelQuery;
    if (isMissingVerifierTable(modelError)) {
      return Response.json({ error: 'AI Proof Verifier tables are not deployed yet.' }, { status: 503 });
    }
    if (modelError) return Response.json({ error: modelError.message }, { status: 500 });
    const model = ((modelRows || []) as VerifierModelRow[])[0];
    if (!model) return Response.json({ error: 'Registered verifier model not found.' }, { status: 404 });
    if (model.status !== 'enabled') {
      return Response.json({ error: `Verifier model is ${model.status}; enable it before accepting proof evidence.` }, { status: 409 });
    }
    if (!model.allowed_proof_systems.includes(proofSystem)) {
      return Response.json({ error: `Proof system ${proofSystem} is not allowed for model ${model.model_ref}.` }, { status: 403 });
    }

    const providedProofHash = normalizeHash(parsed.value.proof_bundle_hash);
    const proofHash = parsed.value.proof_bundle !== undefined
      ? await hashJson(parsed.value.proof_bundle)
      : providedProofHash;
    if (!proofHash) {
      return Response.json({ error: 'proof_bundle or proof_bundle_hash is required.' }, { status: 400 });
    }

    const claimedOutputHash = normalizeHash(parsed.value.claimed_output_hash);
    const publicInputHash = normalizeHash(parsed.value.public_input_hash);
    const attestationEvidenceHash = parsed.value.attestation_evidence !== undefined
      ? await hashJson(parsed.value.attestation_evidence)
      : null;
    const evaluation = evaluateProofBundle({
      proofSystem,
      model,
      projectId: project.id,
      proofBundle: parsed.value.proof_bundle,
      proofHash,
      providedProofHash,
      claimedOutputHash,
    });

    const evidence = {
      ...evaluation.evidence,
      verifier_first: true,
      model_execution_hosted_by_vaultproof: false,
      attestation_evidence_hash: attestationEvidenceHash,
      customer_evidence: safeMetadata(parsed.value.evidence),
      runtime_binding: {
        shared_attestation_mode: SHARED_ATTESTATION_MODE,
        shared_attestation_source: '/readiness',
        runtime_tier: getEnterpriseRuntimeTier(env),
        customer_dedicated_runtime: getEnterpriseRuntimeTier(env) === 'dedicated-production',
        dynamic_guest_attestation_required: true,
        static_attestation_token_allowed: false,
        enterprise_host: env.enterpriseHostname || null,
        executor_configured: Boolean(env.executorBaseUrl),
        azure_front_door_configured: Boolean(env.azureFrontDoorId),
        origin_lock_required: env.originLockRequired === true,
      },
    };

    const { data, error } = await supabase
      .from('organization_proof_verifications')
      .insert({
        organization_id: membership.organization_id,
        project_id: project.id,
        model_id: model.id,
        model_ref: model.model_ref,
        proof_system: proofSystem,
        verifier_version: typeof parsed.value.verifier_version === 'string' && parsed.value.verifier_version.trim()
          ? parsed.value.verifier_version.trim().slice(0, 120)
          : 'vaultproof-verifier-v1',
        status: evaluation.status,
        proof_hash: proofHash,
        public_input_hash: publicInputHash,
        claimed_output_hash: claimedOutputHash,
        external_job_id: typeof parsed.value.external_job_id === 'string' && parsed.value.external_job_id.trim()
          ? parsed.value.external_job_id.trim().slice(0, 160)
          : null,
        failure_reason: evaluation.failureReason,
        evidence,
        submitted_by: auth.userId,
        submitted_email: auth.email,
      })
      .select('*')
      .single();

    if (isMissingVerifierTable(error)) {
      return Response.json({ error: 'AI Proof Verifier tables are not deployed yet.' }, { status: 503 });
    }
    if (error || !data) {
      return Response.json({ error: error?.message || 'Failed to record proof verification.' }, { status: 500 });
    }

    const verification = data as ProofVerificationRow;
    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      project_id: project.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: verificationEventType(verification.status),
      target_type: 'proof_verification',
      target_id: verification.id,
      description: `AI proof ${verification.status} for ${model.model_ref}`,
      metadata: {
        model_ref: model.model_ref,
        proof_system: proofSystem,
        status: verification.status,
        proof_hash: proofHash,
        failure_reason: verification.failure_reason,
        verifier_first: true,
        model_execution_hosted_by_vaultproof: false,
        shared_attestation_mode: SHARED_ATTESTATION_MODE,
      },
    });

    return Response.json({ verification }, { status: verification.status === 'failed' ? 202 : 200 });
  }

  return null;
}
