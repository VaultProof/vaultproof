import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const slackAdapter: ProviderAdapter = {
  id: 'slack',
  name: 'Slack',
  authMethod: 'api-key',
  authInstructions: 'Paste the exposed Slack token (xoxb-... or xoxp-...)',
  canRevoke: true,
  canCreate: false,
  requiresMultiStep: true,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Revoke Slack token',
        description: `Revoke ${finding.maskedValue} via Slack API.`,
        type: 'automated',
      },
      {
        id: 'create-new',
        title: 'Generate new token',
        description: 'Go to your Slack app settings to regenerate the token.',
        type: 'manual',
        manualUrl: 'https://api.slack.com/apps',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' },
      });
      const body = await res.json() as { ok: boolean; error?: string };
      if (!body.ok) return { authenticated: false, sessionData: {}, error: body.error || 'Invalid Slack token' };
      return { authenticated: true, sessionData: { token: credentials.apiKey } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
    const token = auth.sessionData.token as string;
    try {
      const res = await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await res.json() as { ok: boolean; revoked?: boolean };
      if (body.ok || body.revoked) return { success: true };
      return { success: false, error: 'Failed to revoke. Revoke manually from api.slack.com/apps.' };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
