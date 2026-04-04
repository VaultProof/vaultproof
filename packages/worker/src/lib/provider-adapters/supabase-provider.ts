import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const supabaseAdapter: ProviderAdapter = {
  id: 'supabase',
  name: 'Supabase',
  authMethod: 'api-key',
  authInstructions: 'No authentication needed — follow the manual steps to rotate your key on Supabase.',
  canRevoke: false,
  canCreate: false,
  requiresMultiStep: true,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    const isServiceRole = finding.envName.toLowerCase().includes('service_role');
    return [
      {
        id: 'assess',
        title: isServiceRole ? 'Rotate service_role key immediately' : 'Assess anon key exposure',
        description: isServiceRole
          ? 'The service_role key bypasses RLS. Rotate it now.'
          : 'The anon key is public by design if RLS is enabled. Check your RLS policies.',
        type: 'manual',
        manualUrl: 'https://supabase.com/dashboard/project/_/settings/api',
      },
      {
        id: 'rotate',
        title: 'Regenerate key in Supabase Dashboard',
        description: 'Go to Settings > API > Click "Generate new key" for the affected key.',
        type: 'manual',
        manualUrl: 'https://supabase.com/dashboard/project/_/settings/api',
      },
      {
        id: 'update-env',
        title: 'Update environment variables',
        description: 'Replace the old key in all deployment environments.',
        type: 'manual',
      },
    ];
  },

  async authenticate(_credentials: AuthCredentials): Promise<AuthResult> {
    return { authenticated: true, sessionData: {} };
  },

  async revokeKey(_auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
    return { success: true };
  },
};
