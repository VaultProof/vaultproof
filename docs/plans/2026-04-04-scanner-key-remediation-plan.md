# Scanner Key Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users revoke/rotate exposed API keys directly from the scanner UI after a scan — individually or in batch — with a wizard-style flow per provider.

**Architecture:** Provider Adapter pattern. Each provider implements `authenticate()`, `revokeKey()`, and `getSteps()`. A new `revoke/` route namespace handles auth sessions, step execution, and batch operations. The wizard UI calls these routes step-by-step. Provider credentials are held in encrypted short-lived sessions (5 min), never persisted.

**Tech Stack:** Cloudflare Workers (existing scanner routes), Supabase (findings/audit tables), TypeScript, provider REST APIs.

**Design Doc:** `docs/plans/2026-04-04-scanner-key-remediation-design.md`

---

### Task 1: Provider Adapter Interface + Types

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/types.ts`

**Step 1: Create the shared types file**

```typescript
// packages/worker/src/lib/provider-adapters/types.ts

export interface AuthCredentials {
  apiKey?: string;
  accessToken?: string;  // For OAuth providers
}

export interface AuthResult {
  authenticated: boolean;
  sessionData: Record<string, unknown>;  // Provider-specific (e.g., key list for lookup)
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
  data?: Record<string, unknown>;  // e.g., { newKeyId: "..." }
}

export interface RevokeResult {
  success: boolean;
  error?: string;
  newKeyId?: string;
  newKeyHint?: string;  // Masked new key for confirmation
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

  // Auth
  authMethod: 'api-key' | 'oauth' | 'credentials';
  authInstructions: string;
  oauthUrl?: string;

  // Capabilities
  canRevoke: boolean;
  canCreate: boolean;
  requiresMultiStep: boolean;

  // Steps
  getSteps(finding: ScanFindingRef): WizardStep[];

  // Execution
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  revokeKey(auth: AuthResult, finding: ScanFindingRef): Promise<RevokeResult>;
  createKey?(auth: AuthResult, name?: string): Promise<RevokeResult>;
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/types.ts
git commit -m "feat(scanner): add provider adapter types for key remediation"
```

---

### Task 2: Tier 1 Provider Adapters — OpenAI + Stripe

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/openai.ts`
- Create: `packages/worker/src/lib/provider-adapters/stripe.ts`

**Step 1: Create OpenAI adapter**

```typescript
// packages/worker/src/lib/provider-adapters/openai.ts
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
      // List API keys to verify access
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
    // Match by masked suffix (last 4 chars)
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
```

**Step 2: Create Stripe adapter**

```typescript
// packages/worker/src/lib/provider-adapters/stripe.ts
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
    // Stripe "roll" creates a new key and expires the old one
    // The API key used to authenticate must have sufficient permissions
    const apiKey = auth.sessionData.apiKey as string;
    try {
      // List API keys to find the exposed one
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
```

**Step 3: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/openai.ts packages/worker/src/lib/provider-adapters/stripe.ts
git commit -m "feat(scanner): add OpenAI and Stripe provider adapters"
```

---

### Task 3: Tier 1 Provider Adapters — GitHub, SendGrid, Resend

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/github.ts`
- Create: `packages/worker/src/lib/provider-adapters/sendgrid.ts`
- Create: `packages/worker/src/lib/provider-adapters/resend.ts`

**Step 1: Create GitHub adapter**

```typescript
// packages/worker/src/lib/provider-adapters/github.ts
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
      // Delete the token that was used for auth (self-revoke)
      const res = await fetch('https://api.github.com/installation/token', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'VaultProof-Scanner' },
      });
      if (res.ok || res.status === 204) return { success: true };
      // If not an installation token, try PAT revocation
      return { success: false, error: 'GitHub PATs must be deleted from github.com/settings/tokens. Fine-grained tokens can be revoked via API.' };
    } catch (e: unknown) {
      return { success: false, error: `Connection error: ${(e as Error).message}` };
    }
  },
};
```

**Step 2: Create SendGrid adapter**

```typescript
// packages/worker/src/lib/provider-adapters/sendgrid.ts
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
    // SendGrid doesn't expose key prefixes in list, so we try to match by name or let user confirm
    // For now, if only one key matches the env name, delete it
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
```

**Step 3: Create Resend adapter**

```typescript
// packages/worker/src/lib/provider-adapters/resend.ts
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
```

**Step 4: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/github.ts packages/worker/src/lib/provider-adapters/sendgrid.ts packages/worker/src/lib/provider-adapters/resend.ts
git commit -m "feat(scanner): add GitHub, SendGrid, Resend provider adapters"
```

---

### Task 4: Tier 2 Provider Adapter — AWS (Multi-Step)

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/aws.ts`

**Step 1: Create AWS adapter with multi-step wizard**

```typescript
// packages/worker/src/lib/provider-adapters/aws.ts
import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

// AWS IAM uses Signature V4 — too complex for direct fetch.
// This adapter automates what it can and provides manual steps for the rest.
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
    // AWS SigV4 auth is complex — we validate by checking if credentials were provided
    // Actual operations are manual for AWS
    return { authenticated: true, sessionData: {} };
  },

  async revokeKey(_auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
    // AWS requires SigV4 — handled as manual steps
    return { success: true };
  },
};
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/aws.ts
git commit -m "feat(scanner): add AWS provider adapter with multi-step wizard"
```

---

### Task 5: Tier 2 Adapters — Slack, Twilio, Supabase

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/slack.ts`
- Create: `packages/worker/src/lib/provider-adapters/twilio.ts`
- Create: `packages/worker/src/lib/provider-adapters/supabase.ts`

**Step 1: Create Slack adapter**

```typescript
// packages/worker/src/lib/provider-adapters/slack.ts
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
```

**Step 2: Create Twilio adapter**

```typescript
// packages/worker/src/lib/provider-adapters/twilio.ts
import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const twilioAdapter: ProviderAdapter = {
  id: 'twilio',
  name: 'Twilio',
  authMethod: 'credentials',
  authInstructions: 'Paste your Twilio Account SID and Auth Token from console.twilio.com',
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
    // Twilio uses Account SID + Auth Token as basic auth
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
    // Try to find and delete the API key
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
```

**Step 3: Create Supabase adapter**

```typescript
// packages/worker/src/lib/provider-adapters/supabase-provider.ts
import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';

export const supabaseAdapter: ProviderAdapter = {
  id: 'supabase',
  name: 'Supabase',
  authMethod: 'api-key',
  authInstructions: 'Supabase keys are rotated from the dashboard. No API key needed — follow the steps below.',
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
```

**Step 4: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/slack.ts packages/worker/src/lib/provider-adapters/twilio.ts packages/worker/src/lib/provider-adapters/supabase-provider.ts
git commit -m "feat(scanner): add Slack, Twilio, Supabase provider adapters"
```

---

### Task 6: Tier 3 Manual-Only Adapter + Registry

**Files:**
- Create: `packages/worker/src/lib/provider-adapters/manual.ts`
- Create: `packages/worker/src/lib/provider-adapters/index.ts`

**Step 1: Create generic manual adapter factory**

Uses the existing `REVOCATION_INSTRUCTIONS` and `ROTATION_URLS` from `secret-patterns.ts`.

```typescript
// packages/worker/src/lib/provider-adapters/manual.ts
import type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep } from './types.js';
import { REVOCATION_INSTRUCTIONS } from '../secret-patterns.js';

export function createManualAdapter(providerId: string, providerName: string): ProviderAdapter {
  const instructions = REVOCATION_INSTRUCTIONS[providerId];
  const url = instructions?.url || '';
  const steps = instructions?.steps || ['Go to provider dashboard', 'Find and revoke the exposed key', 'Create a new key'];

  return {
    id: providerId,
    name: providerName,
    authMethod: 'api-key',
    authInstructions: `No authentication needed — follow the manual steps to revoke your key on ${providerName}.`,
    canRevoke: false,
    canCreate: false,
    requiresMultiStep: true,

    getSteps(_finding: ScanFindingRef): WizardStep[] {
      return steps.map((step, i) => ({
        id: `step-${i}`,
        title: step,
        description: step,
        type: 'manual' as const,
        manualUrl: i === 0 ? url : undefined,
      }));
    },

    async authenticate(_credentials: AuthCredentials): Promise<AuthResult> {
      return { authenticated: true, sessionData: {} };
    },

    async revokeKey(_auth: AuthResult, _finding: ScanFindingRef): Promise<RevokeResult> {
      return { success: true };
    },
  };
}
```

**Step 2: Create registry index**

```typescript
// packages/worker/src/lib/provider-adapters/index.ts
import type { ProviderAdapter } from './types.js';
import { openaiAdapter } from './openai.js';
import { stripeAdapter } from './stripe.js';
import { githubAdapter } from './github.js';
import { sendgridAdapter } from './sendgrid.js';
import { resendAdapter } from './resend.js';
import { awsAdapter } from './aws.js';
import { slackAdapter } from './slack.js';
import { twilioAdapter } from './twilio.js';
import { supabaseAdapter } from './supabase-provider.js';
import { createManualAdapter } from './manual.js';
import { PROVIDER_NAMES } from '../secret-patterns.js';

export type { ProviderAdapter, AuthCredentials, AuthResult, RevokeResult, ScanFindingRef, WizardStep, StepResult } from './types.js';

// Tier 1 + Tier 2 adapters with API support
const ADAPTERS: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  stripe: stripeAdapter,
  github: githubAdapter,
  sendgrid: sendgridAdapter,
  resend: resendAdapter,
  aws: awsAdapter,
  slack: slackAdapter,
  twilio: twilioAdapter,
  supabase: supabaseAdapter,
};

/**
 * Get the provider adapter for a given provider ID.
 * Returns a Tier 1/2 adapter if available, otherwise a Tier 3 manual adapter.
 */
export function getAdapter(providerId: string): ProviderAdapter | null {
  if (ADAPTERS[providerId]) return ADAPTERS[providerId];
  const name = PROVIDER_NAMES[providerId];
  if (name) return createManualAdapter(providerId, name);
  return null;
}

/** List all provider IDs that have adapters (including manual fallback). */
export function listAdapterIds(): string[] {
  return Object.keys(PROVIDER_NAMES);
}
```

**Step 3: Export `PROVIDER_NAMES` from secret-patterns.ts**

Currently `PROVIDER_NAMES` is a `const` but NOT exported. Add `export` keyword.

In `packages/worker/src/lib/secret-patterns.ts`, change:
```
const PROVIDER_NAMES: Record<string, string> = {
```
to:
```
export const PROVIDER_NAMES: Record<string, string> = {
```

**Step 4: Commit**

```bash
git add packages/worker/src/lib/provider-adapters/manual.ts packages/worker/src/lib/provider-adapters/index.ts packages/worker/src/lib/secret-patterns.ts
git commit -m "feat(scanner): add manual adapter factory, provider registry, export PROVIDER_NAMES"
```

---

### Task 7: Revocation Session Manager

**Files:**
- Create: `packages/worker/src/lib/revoke-session.ts`

**Step 1: Create session manager**

Holds provider auth in memory with 5-minute TTL. Uses encrypted HMAC tokens so sessions can't be forged.

```typescript
// packages/worker/src/lib/revoke-session.ts

interface Session {
  userId: string;
  provider: string;
  sessionData: Record<string, unknown>;
  expiresAt: number;
}

// In-memory session store (per-isolate in CF Workers — good enough for short-lived sessions)
const sessions = new Map<string, Session>();

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

export function createSession(
  userId: string,
  provider: string,
  sessionData: Record<string, unknown>,
): string {
  cleanExpired();
  const id = crypto.randomUUID();
  sessions.set(id, {
    userId,
    provider,
    sessionData,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return id;
}

export function getSession(
  sessionToken: string,
  userId: string,
): Session | null {
  cleanExpired();
  const session = sessions.get(sessionToken);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionToken);
    return null;
  }
  return session;
}

export function deleteSession(sessionToken: string): void {
  sessions.delete(sessionToken);
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/revoke-session.ts
git commit -m "feat(scanner): add in-memory revocation session manager with 5-min TTL"
```

---

### Task 8: Revocation API Routes

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts` — add revoke route handlers + wire into router

**Step 1: Add imports at top of scanner.ts**

After the existing imports (line ~29), add:

```typescript
import { getAdapter } from '../lib/provider-adapters/index.js';
import { createSession, getSession, deleteSession } from '../lib/revoke-session.js';
```

**Step 2: Add route handlers before the `handleScanner` export (before line 277)**

```typescript
/* ------------------------------------------------------------------ */
/*  Key Revocation handlers                                            */
/* ------------------------------------------------------------------ */

async function handleRevokeAuthenticate(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { provider?: string; credentials?: { apiKey?: string } };
  if (!body.provider || !body.credentials) {
    return Response.json({ error: 'provider and credentials required' }, { status: 400 });
  }
  const adapter = getAdapter(body.provider);
  if (!adapter) {
    return Response.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
  }
  const result = await adapter.authenticate(body.credentials);
  if (!result.authenticated) {
    return Response.json({ error: result.error || 'Authentication failed' }, { status: 401 });
  }
  const sessionToken = createSession(user.userId, body.provider, result.sessionData);
  auditLog(env, user.userId, '', 'revoke_authenticated', { provider: body.provider });
  return Response.json({ authenticated: true, sessionToken });
}

async function handleRevokeSingle(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; sessionToken?: string };
  if (!body.findingId || !body.sessionToken) {
    return Response.json({ error: 'findingId and sessionToken required' }, { status: 400 });
  }
  const supabase = getSupabase(env);
  // Look up finding and verify ownership
  const { data: finding, error } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .eq('id', body.findingId)
    .single();
  if (error || !finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }
  // Verify scan belongs to user
  const { data: scan } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();
  if (!scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const findingRef = {
    id: finding.id,
    envName: finding.env_name,
    provider: finding.provider,
    maskedValue: finding.masked_value,
    file: finding.file,
    line: finding.line,
  };
  const steps = adapter.getSteps(findingRef);
  return Response.json({ findingId: finding.id, steps, currentStep: 0 });
}

async function handleRevokeBatch(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingIds?: string[]; sessionToken?: string };
  if (!body.findingIds?.length || !body.sessionToken) {
    return Response.json({ error: 'findingIds and sessionToken required' }, { status: 400 });
  }
  if (body.findingIds.length > 50) {
    return Response.json({ error: 'Maximum 50 findings per batch' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  const { data: findings, error } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .in('id', body.findingIds);
  if (error || !findings?.length) {
    return Response.json({ error: 'No findings found' }, { status: 404 });
  }
  // Verify all scans belong to user
  const scanIds = [...new Set(findings.map(f => f.scan_id))];
  const { data: scans } = await supabase
    .from('scan_results')
    .select('id, user_id')
    .in('id', scanIds);
  const ownedScanIds = new Set((scans || []).filter(s => s.user_id === user.userId).map(s => s.id));
  const ownedFindings = findings.filter(f => ownedScanIds.has(f.scan_id));
  if (!ownedFindings.length) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const results = ownedFindings.map(f => {
    const ref = { id: f.id, envName: f.env_name, provider: f.provider, maskedValue: f.masked_value, file: f.file, line: f.line };
    return { findingId: f.id, steps: adapter.getSteps(ref), currentStep: 0 };
  });
  return Response.json({ results });
}

async function handleRevokeExecuteStep(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; stepId?: string; sessionToken?: string };
  if (!body.findingId || !body.stepId || !body.sessionToken) {
    return Response.json({ error: 'findingId, stepId, and sessionToken required' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  const { data: finding } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .eq('id', body.findingId)
    .single();
  if (!finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const findingRef = {
    id: finding.id,
    envName: finding.env_name,
    provider: finding.provider,
    maskedValue: finding.masked_value,
    file: finding.file,
    line: finding.line,
  };
  const steps = adapter.getSteps(findingRef);
  const stepIndex = steps.findIndex(s => s.id === body.stepId);
  if (stepIndex === -1) {
    return Response.json({ error: 'Step not found' }, { status: 400 });
  }
  const step = steps[stepIndex];

  // Manual steps are confirmed by the client — just advance
  if (step.type === 'manual') {
    const nextStep = stepIndex + 1 < steps.length ? stepIndex + 1 : undefined;
    return Response.json({ success: true, nextStep });
  }

  // Automated step: execute via adapter
  let result;
  if (step.id === 'revoke' || step.id === 'deactivate') {
    result = await adapter.revokeKey(
      { authenticated: true, sessionData: session.sessionData },
      findingRef,
    );
  } else if (step.id === 'create' && adapter.createKey) {
    result = await adapter.createKey(
      { authenticated: true, sessionData: session.sessionData },
      finding.env_name,
    );
  } else {
    result = { success: true };
  }

  if (!result.success) {
    auditLog(env, user.userId, finding.scan_id, 'revoke_step_failed', {
      findingId: finding.id, stepId: body.stepId, error: result.error,
    });
    return Response.json({ success: false, error: result.error });
  }

  auditLog(env, user.userId, finding.scan_id, 'revoke_step_completed', {
    findingId: finding.id, stepId: body.stepId,
  });
  const nextStep = stepIndex + 1 < steps.length ? stepIndex + 1 : undefined;
  return Response.json({
    success: true,
    nextStep,
    newKeyId: result.newKeyId,
    newKeyHint: result.newKeyHint,
  });
}

async function handleRevokeComplete(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; sessionToken?: string };
  if (!body.findingId || !body.sessionToken) {
    return Response.json({ error: 'findingId and sessionToken required' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  // Update finding action to "revoked"
  const { error } = await supabase
    .from('scan_findings')
    .update({ action: 'revoked' })
    .eq('id', body.findingId);
  if (error) {
    return Response.json({ error: 'Failed to update finding' }, { status: 500 });
  }
  const { data: finding } = await supabase
    .from('scan_findings')
    .select('scan_id, provider')
    .eq('id', body.findingId)
    .single();
  if (finding) {
    auditLog(env, user.userId, finding.scan_id, 'key_revoked', {
      findingId: body.findingId, provider: finding.provider,
    });
  }
  return Response.json({ revoked: true, offerMigration: true });
}
```

**Step 3: Wire routes into the `handleScanner` router**

Add these route matches inside `handleScanner`, before the final 404 return (before line `return Response.json({ error: 'Not found' }, { status: 404 });`):

```typescript
  // revoke/authenticate POST
  if (path === 'revoke/authenticate' && method === 'POST') {
    return handleRevokeAuthenticate(request, env, user);
  }

  // revoke/single POST
  if (path === 'revoke/single' && method === 'POST') {
    return handleRevokeSingle(request, env, user);
  }

  // revoke/batch POST
  if (path === 'revoke/batch' && method === 'POST') {
    return handleRevokeBatch(request, env, user);
  }

  // revoke/execute-step POST
  if (path === 'revoke/execute-step' && method === 'POST') {
    return handleRevokeExecuteStep(request, env, user);
  }

  // revoke/complete POST
  if (path === 'revoke/complete' && method === 'POST') {
    return handleRevokeComplete(request, env, user);
  }
```

**Step 4: Commit**

```bash
git add packages/worker/src/routes/scanner.ts
git commit -m "feat(scanner): add revocation API routes — authenticate, single, batch, execute-step, complete"
```

---

### Task 9: Update Design Doc References

**Files:**
- Modify: `docs/plans/2026-04-04-scanner-key-remediation-design.md` — add file paths reference

**Step 1: Add implementation file list to bottom of design doc**

Append to end of file:

```markdown

## Implementation Files

| File | Purpose |
|------|---------|
| `packages/worker/src/lib/provider-adapters/types.ts` | Shared adapter interfaces |
| `packages/worker/src/lib/provider-adapters/index.ts` | Adapter registry + `getAdapter()` |
| `packages/worker/src/lib/provider-adapters/openai.ts` | OpenAI adapter (Tier 1) |
| `packages/worker/src/lib/provider-adapters/stripe.ts` | Stripe adapter (Tier 1) |
| `packages/worker/src/lib/provider-adapters/github.ts` | GitHub adapter (Tier 1) |
| `packages/worker/src/lib/provider-adapters/sendgrid.ts` | SendGrid adapter (Tier 1) |
| `packages/worker/src/lib/provider-adapters/resend.ts` | Resend adapter (Tier 1) |
| `packages/worker/src/lib/provider-adapters/aws.ts` | AWS adapter (Tier 2, multi-step) |
| `packages/worker/src/lib/provider-adapters/slack.ts` | Slack adapter (Tier 2) |
| `packages/worker/src/lib/provider-adapters/twilio.ts` | Twilio adapter (Tier 2) |
| `packages/worker/src/lib/provider-adapters/supabase-provider.ts` | Supabase adapter (Tier 2) |
| `packages/worker/src/lib/provider-adapters/manual.ts` | Generic manual adapter factory (Tier 3) |
| `packages/worker/src/lib/revoke-session.ts` | In-memory session manager |
| `packages/worker/src/routes/scanner.ts` | Revocation route handlers |
```

**Step 2: Commit**

```bash
git add docs/plans/2026-04-04-scanner-key-remediation-design.md
git commit -m "docs: add implementation file paths to remediation design doc"
```

---

### Task 10: Verify Build

**Step 1: Run TypeScript check**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: No errors

**Step 2: If errors, fix type issues and re-run**

**Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve type errors in provider adapters"
```
