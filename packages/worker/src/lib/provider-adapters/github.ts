import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const githubAdapter: ProviderAdapter = {
  id: 'github',
  name: 'GitHub',
  authMethod: 'api-key',
  authInstructions: 'Paste a GitHub personal access token with admin:org or delete permissions from github.com/settings/tokens',
  canRevoke: true,
  canCreate: false,
  requiresMultiStep: false,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Delete exposed GitHub token',
        description: `This will delete the token ${finding.maskedValue}.`,
        type: 'automated',
      },
      {
        id: 'create-new',
        title: 'Create a new token',
        description: 'Generate a new token with minimum required scopes.',
        type: 'manual',
        manualUrl: 'https://github.com/settings/tokens/new',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${credentials.apiKey}`, 'User-Agent': 'VaultProof-Scanner' },
      });
      if (res.status === 401) return { authenticated: false, sessionData: {}, error: 'Invalid GitHub token' };
      if (!res.ok) return { authenticated: false, sessionData: {}, error: `GitHub API error: ${res.status}` };
      return { authenticated: true, sessionData: { token: credentials.apiKey } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
    const token = auth.sessionData.token as string;
    try {
      const res = await fetch('https://api.github.com/installation/token', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'VaultProof-Scanner' },
      });
      if (res.ok || res.status === 204) return { success: true };
      return { success: false, error: 'GitHub PATs must be deleted from github.com/settings/tokens. Fine-grained tokens can be revoked via API.' };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
