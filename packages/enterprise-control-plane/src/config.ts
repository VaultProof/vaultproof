import {
  ENTERPRISE_HOSTNAME,
  isEnterpriseHostname,
  type SignedSecureExecutionEnvelope,
} from '@vaultproof/core';

const DEFAULT_INTERNAL_ADMIN_HOSTNAME = 'admin.vaultproof.dev';

export type EnterpriseRuntimeTier = 'shared-demo' | 'dedicated-production';

export interface EnterpriseControlPlaneEnv {
  enterpriseHostname?: string;
  enterpriseCloudProvider?: string;
  enterpriseRuntimeTier?: EnterpriseRuntimeTier | string;
  internalAdminHostname?: string;
  internalAdminPreviewEnabled?: boolean;
  internalAdminAllowedEmails?: string;
  internalAdminAllowedDomains?: string;
  internalAdminActionsEnabled?: boolean;
  internalAdminApprovalSecret?: string;
  executorBaseUrl?: string;
  executorSigningKeyId?: string;
  executorSigningSecret?: string;
  enterpriseProxyTokenSecret?: string;
  enterpriseExecuteContextCacheTtlMs?: number;
  azureFrontDoorId?: string;
  originLockHeaderName?: string;
  originLockRequired?: boolean;
  originLockSecret?: string;
  trustedSourceIpHeaderSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  mixpanelToken?: string;
  mixpanelAutocapture?: boolean;
  mixpanelRecordSessionsPercent?: number;
}

export interface SecureExecutorDispatchInput {
  envelope: SignedSecureExecutionEnvelope;
  env: EnterpriseControlPlaneEnv;
  fetchImpl?: typeof fetch;
}

export function getEnterpriseHostname(env: EnterpriseControlPlaneEnv): string {
  return (env.enterpriseHostname || ENTERPRISE_HOSTNAME).trim().toLowerCase();
}

export function getEnterpriseRuntimeTier(env: EnterpriseControlPlaneEnv): EnterpriseRuntimeTier {
  return env.enterpriseRuntimeTier === 'shared-demo' ? 'shared-demo' : 'dedicated-production';
}

export function getInternalAdminHostname(env: EnterpriseControlPlaneEnv): string {
  return (env.internalAdminHostname || DEFAULT_INTERNAL_ADMIN_HOSTNAME).trim().toLowerCase();
}

export function isInternalAdminHostname(hostname: string, env: EnterpriseControlPlaneEnv): boolean {
  const configuredHostname = getInternalAdminHostname(env);
  return Boolean(configuredHostname) && hostname.trim().toLowerCase() === configuredHostname;
}

export function isAllowedControlPlaneHostname(hostname: string, env: EnterpriseControlPlaneEnv): boolean {
  const normalized = hostname.trim().toLowerCase();
  const expectedEnterpriseHostname = getEnterpriseHostname(env);
  const configuredInternalAdminHostname = getInternalAdminHostname(env);
  return (normalized === expectedEnterpriseHostname && isEnterpriseHostname(expectedEnterpriseHostname))
    || (Boolean(configuredInternalAdminHostname) && normalized === configuredInternalAdminHostname);
}

export function assertEnterpriseHostname(hostname: string, env: EnterpriseControlPlaneEnv): void {
  const expected = getEnterpriseHostname(env);
  if (hostname !== expected || !isEnterpriseHostname(expected)) {
    throw new Error(`enterprise control plane must run behind ${expected}`);
  }
}

export function assertControlPlaneHostname(hostname: string, env: EnterpriseControlPlaneEnv): void {
  if (!isAllowedControlPlaneHostname(hostname, env)) {
    const configuredInternalAdminHostname = getInternalAdminHostname(env);
    const allowedHosts = configuredInternalAdminHostname
      ? `${getEnterpriseHostname(env)} or ${configuredInternalAdminHostname}`
      : getEnterpriseHostname(env);
    throw new Error(`enterprise control plane must run behind ${allowedHosts}`);
  }
}

export async function dispatchToSecureExecutor({
  envelope,
  env,
  fetchImpl = fetch,
}: SecureExecutorDispatchInput): Promise<Response> {
  if (!env.executorBaseUrl) {
    return Response.json(
      {
        error: 'Enterprise secure executor is not configured yet.',
        requestId: envelope.request.requestId,
      },
      { status: 501 },
    );
  }

  return fetchImpl(`${env.executorBaseUrl.replace(/\/+$/, '')}/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vaultproof-signing-key': env.executorSigningKeyId || envelope.keyId,
    },
    body: JSON.stringify(envelope),
  });
}
