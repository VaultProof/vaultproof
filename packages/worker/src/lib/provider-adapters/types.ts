export interface AuthCredentials {
  apiKey?: string;
  accessToken?: string;
}

export interface AuthResult {
  authenticated: boolean;
  sessionData: Record<string, unknown>;
  error?: string;
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  type: 'automated' | 'manual';
  manualUrl?: string;
}

export interface StepResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface RevokeResult {
  success: boolean;
  error?: string;
  newKeyId?: string;
  newKeyHint?: string;
}

export interface ScanFindingRef {
  id: string;
  envName: string;
  provider: string;
  maskedValue: string;
  file: string;
  line: number | null;
}

export interface ProviderAdapter {
  id: string;
  name: string;
  authMethod: 'api-key' | 'oauth' | 'credentials';
  authInstructions: string;
  oauthUrl?: string;
  canRevoke: boolean;
  canCreate: boolean;
  requiresMultiStep: boolean;
  getSteps(finding: ScanFindingRef): WizardStep[];
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult>;
  createKey?(auth: AuthResult, name?: string): Promise<RevokeResult>;
}
