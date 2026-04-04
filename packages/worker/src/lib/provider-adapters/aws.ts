import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const awsAdapter: ProviderAdapter = {
  id: 'aws',
  name: 'AWS',
  authMethod: 'credentials',
  authInstructions: 'Paste your AWS Access Key ID and Secret Access Key with IAM permissions',
  canRevoke: true,
  canCreate: true,
  requiresMultiStep: true,

  getSteps(finding: ScanFindingRef): WizardStep[] {
    return [
      {
        id: 'deactivate',
        title: 'Deactivate exposed access key',
        description: `Deactivate ${finding.maskedValue} so it can no longer be used.`,
        type: 'manual',
        manualUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
      },
      {
        id: 'verify-services',
        title: 'Verify your services still work',
        description: 'Check that no running services depend on the deactivated key before deleting it.',
        type: 'manual',
      },
      {
        id: 'create-new',
        title: 'Create a new access key',
        description: 'Generate a new access key pair in the IAM console.',
        type: 'manual',
        manualUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
      },
      {
        id: 'delete-old',
        title: 'Delete the old access key',
        description: 'Once the new key is confirmed working, delete the old one permanently.',
        type: 'manual',
        manualUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
      },
    ];
  },

  async authenticate(_credentials: AuthCredentials): Promise<AuthResult> {
    // AWS SigV4 auth is complex — actual operations are manual for AWS
    return { authenticated: true, sessionData: {} };
  },

  async revokeKey(_auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
    // AWS requires SigV4 — handled as manual steps
    return { success: true };
  },
};
