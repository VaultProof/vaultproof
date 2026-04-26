export type ExecutionTier = 'b2c_edge' | 'b2b_enterprise';

export const B2C_API_HOSTNAME = 'api.vaultproof.dev';
export const ENTERPRISE_HOSTNAME = 'enterprise.vaultproof.dev';

export interface RuntimeRouteBoundary {
  hostname: string;
  executionTier: ExecutionTier;
  description: string;
}

export const RUNTIME_ROUTE_BOUNDARIES: RuntimeRouteBoundary[] = [
  {
    hostname: B2C_API_HOSTNAME,
    executionTier: 'b2c_edge',
    description: 'Cloudflare-backed self-serve and B2C runtime.',
  },
  {
    hostname: ENTERPRISE_HOSTNAME,
    executionTier: 'b2b_enterprise',
    description: 'Azure-backed enterprise runtime with confidential execution.',
  },
];

export function getExecutionTierForHostname(hostname: string): ExecutionTier | null {
  const normalized = hostname.trim().toLowerCase();
  const match = RUNTIME_ROUTE_BOUNDARIES.find((entry) => entry.hostname === normalized);
  return match?.executionTier || null;
}

export function isEnterpriseHostname(hostname: string): boolean {
  return getExecutionTierForHostname(hostname) === 'b2b_enterprise';
}
