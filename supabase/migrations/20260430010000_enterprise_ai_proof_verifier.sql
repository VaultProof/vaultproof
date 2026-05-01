-- Enterprise AI Proof Verifier.
--
-- Verifier-first model:
-- - VaultProof does not run the model.
-- - Customers or partner systems submit proof bundles/evidence.
-- - VaultProof records verifier decisions, hashes, policy context, and audit
--   evidence tied to organization/project access.

CREATE TABLE IF NOT EXISTS public.organization_verifier_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  model_ref text NOT NULL,
  display_name text NOT NULL,
  model_family text NOT NULL DEFAULT 'custom'
    CHECK (model_family IN ('classification', 'regression', 'ranking', 'embedding', 'llm', 'vision', 'custom')),
  allowed_proof_systems text[] NOT NULL DEFAULT ARRAY['vaultproof-manifest-v1']::text[],
  status text NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled', 'planned')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, model_ref)
);

CREATE INDEX IF NOT EXISTS organization_verifier_models_org_project_idx
  ON public.organization_verifier_models (organization_id, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS organization_verifier_models_ref_idx
  ON public.organization_verifier_models (organization_id, model_ref);

ALTER TABLE public.organization_verifier_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_verifier_models_select_visible ON public.organization_verifier_models;
CREATE POLICY organization_verifier_models_select_visible
  ON public.organization_verifier_models
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = organization_verifier_models.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_verifier_models.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

CREATE TABLE IF NOT EXISTS public.organization_proof_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.organization_verifier_models(id) ON DELETE CASCADE,
  model_ref text NOT NULL,
  proof_system text NOT NULL
    CHECK (proof_system IN ('vaultproof-manifest-v1', 'world-zk-compute', 'ezkl', 'risc0', 'tee-attestation', 'external-verifier')),
  verifier_version text NOT NULL DEFAULT 'vaultproof-verifier-v1',
  status text NOT NULL
    CHECK (status IN ('verified', 'recorded', 'failed')),
  proof_hash text NOT NULL,
  public_input_hash text,
  claimed_output_hash text,
  external_job_id text,
  failure_reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_proof_verifications_org_created_idx
  ON public.organization_proof_verifications (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_proof_verifications_project_created_idx
  ON public.organization_proof_verifications (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_proof_verifications_model_created_idx
  ON public.organization_proof_verifications (model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organization_proof_verifications_status_idx
  ON public.organization_proof_verifications (organization_id, status, created_at DESC);

ALTER TABLE public.organization_proof_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_proof_verifications_select_visible ON public.organization_proof_verifications;
CREATE POLICY organization_proof_verifications_select_visible
  ON public.organization_proof_verifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = organization_proof_verifications.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_proof_verifications.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'security_admin', 'platform_admin', 'auditor')
    )
  );

GRANT SELECT ON public.organization_verifier_models TO authenticated;
GRANT SELECT ON public.organization_proof_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_verifier_models TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_proof_verifications TO service_role;
