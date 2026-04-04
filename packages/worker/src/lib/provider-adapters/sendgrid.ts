import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const sendgridAdapter: ProviderAdapter = {
  id: 'sendgrid',
  name: 'SendGrid',
  authMethod: 'api-key',
  authInstructions: 'Paste a SendGrid API key with Full Access permissions from app.sendgrid.com/settings/api_keys',
  canRevoke: true,
  canCreate: true,
  requiresMultiStep: false,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Delete exposed SendGrid key',
        description: `This will permanently delete the key ${finding.maskedValue}.`,
        type: 'automated',
      },
      {
        id: 'create',
        title: 'Create replacement key (optional)',
        description: 'Generate a new SendGrid API key.',
        type: 'automated',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/api_keys', {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (res.status === 401 || res.status === 403) return { authenticated: false, sessionData: {}, error: 'Invalid or insufficient permissions' };
      if (!res.ok) return { authenticated: false, sessionData: {}, error: `SendGrid API error: ${res.status}` };
      const body = await res.json() as { result?: Array<{ api_key_id: string; name: string }> };
      return { authenticated: true, sessionData: { apiKey: credentials.apiKey, keys: body.result || [] } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    const keys = auth.sessionData.keys as Array<{ api_key_id: string; name: string }>;
    const match = keys.find(k => k.name.toLowerCase().includes(finding.envName.toLowerCase().replace(/_/g, ' ')));
    if (!match) {
      return { success: false, error: `Could not auto-match key. Delete manually at app.sendgrid.com/settings/api_keys` };
    }
    try {
      const res = await fetch(`https://api.sendgrid.com/v3/api_keys/${match.api_key_id}`, {
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
      const res = await fetch('https://api.sendgrid.com/v3/api_keys', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'VaultProof-rotated', scopes: ['mail.send'] }),
      });
      if (!res.ok) return { success: false, error: `Failed to create key: ${res.status}` };
      const body = await res.json() as { api_key_id: string; api_key: string };
      return { success: true, newKeyId: body.api_key_id, newKeyHint: body.api_key.slice(0, 6) + '...' };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
