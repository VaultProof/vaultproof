-- Multi-cloud customer-managed key onboarding.
--
-- Existing AWS KMS rows stay valid. New columns store safe resource identifiers
-- only: cloud account/project/subscription IDs, key resource names, role/principal
-- IDs, and VaultProof-generated external IDs. Raw cloud credentials and provider
-- API keys must never be stored here.

ALTER TABLE public.organization_kms_connections
  ADD COLUMN IF NOT EXISTS gcp_project_id text,
  ADD COLUMN IF NOT EXISTS gcp_location text,
  ADD COLUMN IF NOT EXISTS gcp_key_ring text,
  ADD COLUMN IF NOT EXISTS gcp_crypto_key_resource text,
  ADD COLUMN IF NOT EXISTS gcp_service_account text,
  ADD COLUMN IF NOT EXISTS gcp_key_version text,
  ADD COLUMN IF NOT EXISTS azure_tenant_id text,
  ADD COLUMN IF NOT EXISTS azure_subscription_id text,
  ADD COLUMN IF NOT EXISTS azure_resource_group text,
  ADD COLUMN IF NOT EXISTS azure_key_vault_uri text,
  ADD COLUMN IF NOT EXISTS azure_key_name text,
  ADD COLUMN IF NOT EXISTS azure_key_version text,
  ADD COLUMN IF NOT EXISTS azure_principal_id text,
  ADD COLUMN IF NOT EXISTS azure_key_type text;

ALTER TABLE public.organization_kms_connections
  DROP CONSTRAINT IF EXISTS organization_kms_connections_provider_check;

ALTER TABLE public.organization_kms_connections
  ADD CONSTRAINT organization_kms_connections_provider_check
    CHECK (provider IN ('aws-kms', 'gcp-cloud-kms', 'azure-key-vault'));

ALTER TABLE public.organization_kms_connections
  DROP CONSTRAINT IF EXISTS organization_kms_connections_gcp_resource_check;

ALTER TABLE public.organization_kms_connections
  ADD CONSTRAINT organization_kms_connections_gcp_resource_check
    CHECK (
      gcp_crypto_key_resource IS NULL
      OR gcp_crypto_key_resource ~ '^projects/[^/]+/locations/[^/]+/keyRings/[^/]+/cryptoKeys/[^/]+$'
    );

ALTER TABLE public.organization_kms_connections
  DROP CONSTRAINT IF EXISTS organization_kms_connections_gcp_service_account_check;

ALTER TABLE public.organization_kms_connections
  ADD CONSTRAINT organization_kms_connections_gcp_service_account_check
    CHECK (
      gcp_service_account IS NULL
      OR gcp_service_account ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$'
    );

ALTER TABLE public.organization_kms_connections
  DROP CONSTRAINT IF EXISTS organization_kms_connections_azure_key_type_check;

ALTER TABLE public.organization_kms_connections
  ADD CONSTRAINT organization_kms_connections_azure_key_type_check
    CHECK (azure_key_type IS NULL OR azure_key_type IN ('key_vault', 'managed_hsm'));

ALTER TABLE public.organization_kms_connections
  DROP CONSTRAINT IF EXISTS organization_kms_connections_azure_key_uri_check;

ALTER TABLE public.organization_kms_connections
  ADD CONSTRAINT organization_kms_connections_azure_key_uri_check
    CHECK (
      azure_key_vault_uri IS NULL
      OR azure_key_vault_uri ~ '^https://[A-Za-z0-9-]+(\.vault\.azure\.net|\.managedhsm\.azure\.net)/?$'
    );

CREATE INDEX IF NOT EXISTS organization_kms_connections_gcp_project_idx
  ON public.organization_kms_connections (gcp_project_id);

CREATE INDEX IF NOT EXISTS organization_kms_connections_azure_subscription_idx
  ON public.organization_kms_connections (azure_subscription_id);
