import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const resendAdapter: ProviderAdapter = {
  id: 'resend',
  name: 'Resend',
  authMethod: 'api-key',
  authInstructions: 'Paste a Resend API key from resend.com/api-keys',
  canRevoke: true,
  canCreate: true,
  requiresMultiStep: false,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Delete exposed Resend key',
        description: `This will delete the key ${finding.maskedValue}.`,
        type: 'automated',
      },
      {
        id: 'create',
        title: 'Create replacement key (optional)',
        description: 'Generate a new Resend API key.',
        type: 'automated',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (res.status === 401) return { authenticated: false, sessionData: {}, error: 'Invalid Resend API key' };
      if (!res.ok) return { authenticated: false, sessionData: {}, error: `Resend API error: ${res.status}` };
      const body = await res.json() as { data?: Array<{ id: string; name: string }> };
      return { authenticated: true, sessionData: { apiKey: credentials.apiKey, keys: body.data || [] } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    const keys = auth.sessionData.keys as Array<{ id: string; name: string }>;
    const match = keys.find(k => k.name.toLowerCase().includes(finding.envName.toLowerCase().replace(/_/g, ' ')));
    if (!match) {
      return { success: false, error: `Could not auto-match key. Delete manually at resend.com/api-keys` };
    }
    try {
      const res = await fetch(`https://api.resend.com/api-keys/${match.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok || res.status === 204) return { success: true };
      return { success: false, error: `Failed to delete: ${res.status}` };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async createKey(auth: AuthResult, name?: string): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    try {
      const res = await fetch('https://api.resend.com/api-keys', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'VaultProof-rotated' }),
      });
      if (!res.ok) return { success: false, error: `Failed to create key: ${res.status}` };
      const body = await res.json() as { id: string; token: string };
      return { success: true, newKeyId: body.id, newKeyHint: body.token.slice(0, 8) + '...' };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
