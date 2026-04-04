import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  name: 'OpenAI',
  authMethod: 'api-key',
  authInstructions: 'Paste an OpenAI API key with admin permissions from platform.openai.com/api-keys',
  canRevoke: true,
  canCreate: true,
  requiresMultiStep: false,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Revoke exposed key',
        description: `This will permanently revoke the key ${finding.maskedValue} on OpenAI.`,
        type: 'automated',
      },
      {
        id: 'create',
        title: 'Create replacement key (optional)',
        description: 'Generate a new API key on OpenAI to replace the revoked one.',
        type: 'automated',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://api.openai.com/v1/organization/api_keys?limit=100', {
        headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        return { authenticated: false, sessionData: {}, error: 'Invalid API key or insufficient permissions' };
      }
      if (!res.ok) {
        return { authenticated: false, sessionData: {}, error: `OpenAI API error: ${res.status}` };
      }
      const body = await res.json() as { data?: Array<{ id: string; name: string; redacted_value?: string }> };
      return {
        authenticated: true,
        sessionData: { apiKey: credentials.apiKey, keys: body.data || [] },
      };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    const keys = auth.sessionData.keys as Array<{ id: string; redacted_value?: string }>;
    const suffix = finding.maskedValue.slice(-4);
    const match = keys.find(k => k.redacted_value?.endsWith(suffix));
    if (!match) {
      return { success: false, error: `Could not find key matching ${finding.maskedValue} in your account. It may already be revoked.` };
    }
    try {
      const res = await fetch(`https://api.openai.com/v1/organization/api_keys/${match.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok || res.status === 204) {
        return { success: true };
      }
      return { success: false, error: `Failed to revoke: ${res.status} ${res.statusText}` };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async createKey(auth: AuthResult, name?: string): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    try {
      const res = await fetch('https://api.openai.com/v1/organization/api_keys', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'VaultProof-rotated' }),
      });
      if (!res.ok) {
        return { success: false, error: `Failed to create key: ${res.status}` };
      }
      const body = await res.json() as { id: string; redacted_value?: string };
      return { success: true, newKeyId: body.id, newKeyHint: body.redacted_value };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
