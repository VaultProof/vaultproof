import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const stripeAdapter: ProviderAdapter = {
  id: 'stripe',
  name: 'Stripe',
  authMethod: 'api-key',
  authInstructions: 'Paste your Stripe secret key (sk_live_... or sk_test_...) from dashboard.stripe.com/apikeys',
  canRevoke: true,
  canCreate: false,
  requiresMultiStep: false,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'revoke',
        title: 'Roll exposed Stripe key',
        description: `This will roll the key ${finding.maskedValue}, creating a new key and revoking the old one.`,
        type: 'automated',
      },
      {
        id: 'update-env',
        title: 'Update your environment variables',
        description: 'Copy the new key and update your deployment environment.',
        type: 'manual',
        manualUrl: 'https://dashboard.stripe.com/apikeys',
      },
    ];
  },

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (res.status === 401) {
        return { authenticated: false, sessionData: {}, error: 'Invalid Stripe key' };
      }
      if (!res.ok) {
        return { authenticated: false, sessionData: {}, error: `Stripe API error: ${res.status}` };
      }
      return { authenticated: true, sessionData: { apiKey: credentials.apiKey } };
    } catch (e: unknown) {
      return { authenticated: false, sessionData: {}, error: `Connection error: ${(e as Error).message}` };
    }
  },

  async revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult> {
    const apiKey = auth.sessionData.apiKey as string;
    try {
      const listRes = await fetch('https://api.stripe.com/v1/api_keys', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!listRes.ok) {
        return { success: false, error: `Cannot list keys: ${listRes.status}. Use the Stripe Dashboard to roll this key manually.` };
      }
      const body = await listRes.json() as { data?: Array<{ id: string; redacted: string }> };
      const suffix = finding.maskedValue.slice(-4);
      const match = (body.data || []).find(k => k.redacted?.endsWith(suffix));
      if (!match) {
        return { success: false, error: `Could not find key matching ${finding.maskedValue}. It may already be rolled.` };
      }
      const rollRes = await fetch(`https://api.stripe.com/v1/api_keys/${match.id}/roll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!rollRes.ok) {
        return { success: false, error: `Failed to roll key: ${rollRes.status}. Use the Stripe Dashboard.` };
      }
      const rolled = await rollRes.json() as { id: string; redacted: string };
      return { success: true, newKeyId: rolled.id, newKeyHint: rolled.redacted };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
