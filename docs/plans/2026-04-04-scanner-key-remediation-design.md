# Scanner Key Remediation Design

**Date:** 2026-04-04
**Status:** Approved

## Summary

After a scan detects exposed API keys, users can revoke/rotate them directly from the scanner UI. Supports all 33+ providers — automated API revocation where possible, guided wizard for the rest.

## Decisions

- **Provider coverage:** All 33+ providers from day one
- **UX:** Individual revoke buttons per finding + batch "Revoke All Selected"
- **Auth:** User authenticates with each provider (API key or OAuth) before revoking — we don't reuse the exposed key
- **Post-revocation:** Dismissible banner offers VaultProof proxy migration
- **Multi-step flows:** Wizard-style modal with step-by-step progress

## Architecture: Provider Adapter Pattern

Each provider implements a standard adapter interface. The scanner orchestrates wizard steps by calling adapter methods.

### Adapter Interface

```typescript
interface ProviderAdapter {
  id: string;                    // "openai", "stripe", "aws"
  name: string;                  // "OpenAI", "Stripe", "AWS"

  // Auth
  authMethod: "api-key" | "oauth" | "credentials";
  authInstructions: string;      // "Paste your OpenAI API key"
  oauthUrl?: string;

  // Capabilities
  canRevoke: boolean;
  canCreate: boolean;
  requiresMultiStep: boolean;

  // Steps the wizard will walk through
  getSteps(finding: ScanFinding): WizardStep[];

  // Execution
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  revokeKey(auth: AuthResult, finding: ScanFinding): Promise<RevokeResult>;
  createKey?(auth: AuthResult, name?: string): Promise<CreateKeyResult>;
}

interface WizardStep {
  id: string;
  title: string;
  description: string;
  type: "automated" | "manual";
  manualUrl?: string;
  execute?: () => Promise<StepResult>;
}
```

### Simple Example (OpenAI)

2 steps: revoke old key (automated via API), optional create new key (automated).

### Complex Example (AWS)

4 steps: deactivate access key (automated), confirm services updated (manual), create new access key (automated), delete old key (automated).

## API Routes

```
POST /scanner/revoke/authenticate
  Body: { provider: "openai", credentials: { apiKey: "sk-..." } }
  Returns: { authenticated: boolean, sessionToken: string }
  Session token: short-lived (5 min), encrypted in memory

POST /scanner/revoke/single
  Body: { findingId: "uuid", sessionToken: string }
  Returns: { steps: WizardStep[], currentStep: 0 }

POST /scanner/revoke/batch
  Body: { findingIds: ["uuid", ...], sessionToken: string }
  Returns: { results: [{ findingId, steps, currentStep }] }

POST /scanner/revoke/execute-step
  Body: { findingId: "uuid", stepId: string, sessionToken: string }
  Returns: { success: boolean, nextStep?: number, error?: string }

POST /scanner/revoke/complete
  Body: { findingId: "uuid", sessionToken: string }
  Returns: { revoked: boolean, offerMigration: boolean }
```

### Security

- Provider credentials never stored — held in encrypted short-lived session only
- Each step executed individually for wizard progress
- Audit log entry for every revocation action
- Finding status updated to `action: "revoked"` on completion

## Wizard UI Flow

### Findings Grid

- Each finding row: "Revoke" button
- Top of grid: checkboxes + "Revoke All Selected"

### Auth Modal

- Grouped by provider (authenticate once per provider, not per key)
- Shows `authInstructions` and input field per provider

### Wizard Modal

Steps listed vertically with status icons:
- ○ Pending
- ◉ In Progress (spinner)
- ✓ Complete
- ✗ Failed (with retry button)

Automated steps execute on "Next". Manual steps show URL/instructions and "I've done this" confirmation.

### Completion Screen

- Summary of revoked keys
- Dismissible banner: "Key revoked. Secure your replacement with VaultProof?" with "Set up proxy" / "Maybe later"

### Batch Flow

Sequential per provider: auth once → revoke all keys for that provider → next provider. User can skip individual findings without aborting the batch.

### Error Handling

Failed step: wizard stays on that step with error + retry button.

## Provider Coverage Tiers

### Tier 1 — Full API Revocation (Launch)

| Provider | Revocation API |
|----------|---------------|
| OpenAI | DELETE /v1/api-keys/{id} |
| Stripe | DELETE /v1/api_keys/{id} or roll |
| GitHub | DELETE /user/keys/{id} |
| SendGrid | DELETE /v3/api_keys/{id} |
| Resend | DELETE /api-keys/{id} |

### Tier 2 — API Revocation with Extra Steps

| Provider | Flow |
|----------|------|
| AWS | Deactivate → create new → delete old (IAM API) |
| Slack | auth.revoke endpoint |
| Twilio | DELETE /Accounts/{sid}/Keys/{sid} |
| Supabase | Regenerate via management API |

### Tier 3 — Manual Wizard Only

Anthropic, Google Cloud, Together, Groq, Perplexity, Replicate, Fireworks, DeepSeek, Mistral, Cohere, Discord, MongoDB, Neon, Upstash, FaunaDB, npm, Datadog, Apollo, Contentful, PostHog, Brevo

Same wizard UI but all steps are `type: "manual"` with direct links to key management pages and step-by-step instructions. Can be upgraded to Tier 1/2 as provider APIs allow.
