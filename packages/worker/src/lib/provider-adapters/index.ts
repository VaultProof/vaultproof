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

export function getAdapter(providerId: string): ProviderAdapter | null {
  if (ADAPTERS[providerId]) return ADAPTERS[providerId];
  const name = PROVIDER_NAMES[providerId];
  if (name) return createManualAdapter(providerId, name);
  return null;
}

export function listAdapterIds(): string[] {
  return Object.keys(PROVIDER_NAMES);
}
