/**
 * Environment variable name resolution for stored API keys.
 *
 * Handles multi-key providers (e.g. Supabase has anon + service_role)
 * so that `vaultproof env` and `vaultproof exec` export the right names.
 */

export const ENV_VAR_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  groq: "GROQ_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
  stripe: "STRIPE_SECRET_KEY",
  aws: "AWS_SECRET_ACCESS_KEY",
  twilio: "TWILIO_AUTH_TOKEN",
  sendgrid: "SENDGRID_API_KEY",
  github: "GITHUB_TOKEN",
};

// Known label → env var overrides for providers with multiple keys
export const LABEL_VAR_MAP: Record<string, Record<string, string>> = {
  supabase: {
    anon: "SUPABASE_ANON_KEY",
    anon_key: "SUPABASE_ANON_KEY",
    service_role: "SUPABASE_SERVICE_ROLE_KEY",
    service_role_key: "SUPABASE_SERVICE_ROLE_KEY",
    jwt_secret: "SUPABASE_JWT_SECRET",
    url: "SUPABASE_URL",
  },
  stripe: {
    secret: "STRIPE_SECRET_KEY",
    secret_key: "STRIPE_SECRET_KEY",
    publishable: "STRIPE_PUBLISHABLE_KEY",
    publishable_key: "STRIPE_PUBLISHABLE_KEY",
    webhook_secret: "STRIPE_WEBHOOK_SECRET",
  },
  aws: {
    access_key: "AWS_ACCESS_KEY_ID",
    secret_key: "AWS_SECRET_ACCESS_KEY",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    region: "AWS_REGION",
  },
  firebase: {
    api_key: "FIREBASE_API_KEY",
    auth_domain: "FIREBASE_AUTH_DOMAIN",
    project_id: "FIREBASE_PROJECT_ID",
    service_account: "FIREBASE_SERVICE_ACCOUNT_KEY",
  },
  twilio: {
    auth_token: "TWILIO_AUTH_TOKEN",
    account_sid: "TWILIO_ACCOUNT_SID",
  },
};

/**
 * Resolve the env var name for a key.
 * Priority: --var flag > stored envVar > label map > provider map > PROVIDER_LABEL
 */
export function resolveEnvVar(
  key: { provider: string; label: string; envVar?: string | null },
  allKeys: Array<{ provider: string; label: string }>,
  customVar?: string
): string {
  if (customVar) return customVar;

  // Stored envVar is the source of truth
  if (key.envVar) return key.envVar;

  const provider = key.provider.toLowerCase();
  const labelNorm = key.label.toLowerCase().replace(/[\s-]+/g, "_");

  // Check known label mappings first
  const labelMap = LABEL_VAR_MAP[provider];
  if (labelMap && labelMap[labelNorm]) {
    return labelMap[labelNorm];
  }

  // Count how many keys share this provider
  const sameProvider = allKeys.filter(
    (k) => k.provider.toLowerCase() === provider
  );

  // Single key → use standard env var
  if (sameProvider.length === 1) {
    return ENV_VAR_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
  }

  // Multiple keys, no known mapping → PROVIDER_LABEL format
  const base = ENV_VAR_MAP[provider]?.replace(/_API_KEY$|_SECRET_KEY$|_AUTH_TOKEN$|_TOKEN$/, "")
    || provider.toUpperCase();
  const suffix = labelNorm.toUpperCase();
  return `${base}_${suffix}`;
}
