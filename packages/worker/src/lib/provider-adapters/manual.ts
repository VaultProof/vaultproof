import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';
import { REVOCATION_INSTRUCTIONS } from '../secret-patterns.js';

export function createManualAdapter(providerId: string, providerName: string): ProviderAdapter {
  const instructions = REVOCATION_INSTRUCTIONS[providerId];
  const url = instructions?.url || '';
  const steps = instructions?.steps || ['Go to provider dashboard', 'Find and revoke the exposed key', 'Create a new key'];

  return {
    id: providerId,
    name: providerName,
    authMethod: 'api-key',
    authInstructions: `No authentication needed — follow the manual steps to revoke your key on ${providerName}.`,
    canRevoke: false,
    canCreate: false,
    requiresMultiStep: true,

    getSteps(_finding: ScanFindingRef): WizardStep[] {
      return steps.map((step, i) => ({
        id: `step-${i}`,
        title: step,
        description: step,
        type: 'manual' as const,
        manualUrl: i === 0 ? url : undefined,
      }));
    },

    async authenticate(_credentials: AuthCredentials): Promise<AuthResult> {
      return { authenticated: true, sessionData: {} };
    },

    async revokeKey(_auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
      return { success: true };
    },
  };
}
