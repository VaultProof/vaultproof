import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const twilioAdapter: ProviderAdapter = {
  id: 'twilio',
  name: 'Twilio',
  authMethod: 'credentials',
  authInstructions: 'Paste your Twilio Account SID and Auth Token from console.twilio.com (format: AccountSID:AuthToken)',
  canRevoke: true,
  canCreate: false,
  requiresMultiStep: true,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Delete exposed Twilio key',
        description: `Delete ${finding.maskedValue} via Twilio API.`,
        type: 'automated',
      },
      {
        id: 'create-new',
        title: 'Create new API key',
        description: 'Generate a new API key from the Twilio console.',
        type: 'manual',
        manualUrl: 'https://console.twilio.com',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const apiKey = credentials.apiKey || '';
    const parts = apiKey.split(':');
    if (parts.length !== 2) return { authenticated: false, sessionData: {}, error: 'Enter as AccountSID:AuthToken' };
    const [sid, token] = parts;
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) },
      });
      if (res.status === 401) return { authenticated: false, sessionData: {}, error: 'Invalid credentials' };
      if (!res.ok) return { authenticated: false, sessionData: {}, error: `Twilio API error: ${res.status}` };
      return { authenticated: true, sessionData: { sid, token } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult> {
    const sid = auth.sessionData.sid as string;
    const token = auth.sessionData.token as string;
    try {
      const listRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Keys.json`, {
        headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) },
      });
      if (!listRes.ok) return { success: false, error: `Cannot list keys: ${listRes.status}` };
      const body = await listRes.json() as { keys?: Array<{ sid: string }> };
      const suffix = finding.maskedValue.slice(-4);
      const match = (body.keys || []).find(k => k.sid.endsWith(suffix));
      if (!match) return { success: false, error: 'Could not find matching key. Delete manually at console.twilio.com.' };
      const delRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Keys/${match.sid}.json`, {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) },
      });
      if (delRes.ok || delRes.status === 204) return { success: true };
      return { success: false, error: `Failed to delete: ${delRes.status}` };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
