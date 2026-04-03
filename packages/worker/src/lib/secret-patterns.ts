/**
 * Secret Detection Patterns Module
 *
 * All regex patterns, helper functions, and constants needed for scanning
 * GitHub repos for exposed API keys. Synced with backend scanner patterns.
 */

// ─── Key prefix detection patterns ─────────────────────────────────────────

export const KEY_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  // AI / LLM
  { pattern: /^sk-proj-/, provider: 'openai' },
  { pattern: /^sk-[a-zA-Z0-9]{40,}$/, provider: 'openai' },
  { pattern: /^sk-ant-/, provider: 'anthropic' },
  { pattern: /^tog_/, provider: 'together' },
  { pattern: /^gsk_[a-zA-Z0-9]{40,}$/, provider: 'groq' },
  { pattern: /^pplx-[a-zA-Z0-9]{40,}$/, provider: 'perplexity' },
  { pattern: /^r8_[a-zA-Z0-9]{30,}$/, provider: 'replicate' },
  { pattern: /^fw_[a-zA-Z0-9]{30,}$/, provider: 'fireworks' },
  // Payments
  { pattern: /^sk_live_/, provider: 'stripe' },
  { pattern: /^sk_test_/, provider: 'stripe' },
  { pattern: /^pk_live_/, provider: 'stripe' },
  { pattern: /^pk_test_/, provider: 'stripe' },
  { pattern: /^whsec_/, provider: 'stripe' },
  { pattern: /^rk_live_/, provider: 'stripe' },
  { pattern: /^rk_test_/, provider: 'stripe' },
  // Google
  { pattern: /^AIza[0-9A-Za-z_-]{35}$/, provider: 'google' },
  // AWS
  { pattern: /^AKIA[0-9A-Z]{16}$/, provider: 'aws' },
  { pattern: /^ASIA[0-9A-Z]{16}$/, provider: 'aws' },
  // Email
  { pattern: /^SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, provider: 'sendgrid' },
  { pattern: /^re_[a-zA-Z0-9]{20,}$/, provider: 'resend' },
  { pattern: /^xkeysib-[a-zA-Z0-9]{40,}$/, provider: 'brevo' },
  // Messaging
  { pattern: /^xoxb-/, provider: 'slack' },
  { pattern: /^xoxp-/, provider: 'slack' },
  // GitHub
  { pattern: /^ghp_[a-zA-Z0-9]{36}$/, provider: 'github' },
  { pattern: /^ghs_[a-zA-Z0-9]{36}$/, provider: 'github' },
  { pattern: /^github_pat_/, provider: 'github' },
  // Supabase
  { pattern: /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./, provider: 'supabase' },
  // Twilio
  { pattern: /^SK[a-f0-9]{32}$/, provider: 'twilio' },
  // npm
  { pattern: /^npm_[a-zA-Z0-9]{36}$/, provider: 'npm' },
  // Datadog
  { pattern: /^dd[a-z]_[a-zA-Z0-9]{32,}$/, provider: 'datadog' },
  // GraphQL / CMS / BaaS
  { pattern: /^service:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/, provider: 'apollo' },
  { pattern: /^CFPAT-[a-zA-Z0-9_-]{40,}$/, provider: 'contentful' },
  { pattern: /^fnA[a-zA-Z0-9_-]{20,}$/, provider: 'fauna' },
  { pattern: /^phc_[a-zA-Z0-9]{30,}$/, provider: 'posthog' },
  { pattern: /^nk_[a-zA-Z0-9]{20,}$/, provider: 'neon' },
  { pattern: /^AX[a-zA-Z0-9]{30,}$/, provider: 'upstash' },
  // Databases
  { pattern: /^mongodb\+srv:\/\//, provider: 'mongodb' },
];

// ─── SDK initialization patterns ───────────────────────────────────────────

export const SDK_INIT_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /new\s+OpenAI\s*\(/g, provider: 'openai' },
  { pattern: /new\s+Anthropic\s*\(/g, provider: 'anthropic' },
  { pattern: /new\s+GoogleGenerativeAI\s*\(/g, provider: 'google' },
  { pattern: /OpenAI\s*\(\s*(?:api_key|$)/g, provider: 'openai' },
  { pattern: /Anthropic\s*\(\s*(?:api_key|$)/g, provider: 'anthropic' },
  { pattern: /genai\.configure\s*\(/g, provider: 'google' },
];

// ─── HTTP URL patterns ─────────────────────────────────────────────────────

export const PROVIDER_URLS: Record<string, string> = {
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'api.together.xyz': 'together',
  'api.mistral.ai': 'mistral',
  'api.cohere.ai': 'cohere',
  'api.groq.com': 'groq',
  'api.perplexity.ai': 'perplexity',
  'api.fireworks.ai': 'fireworks',
  'api.deepseek.com': 'deepseek',
  'api.replicate.com': 'replicate',
};

export const HTTP_URL_PATTERNS: Array<{ pattern: RegExp; provider: string }> = Object.entries(PROVIDER_URLS).map(
  ([domain, provider]) => ({
    pattern: new RegExp(`https?://${domain.replace(/\./g, '\\.')}(/[^\\s"'\`]*)?`, 'g'),
    provider,
  })
);

// Pre-built combined regex for fast scanning
export const HTTP_URL_REGEX = new RegExp(
  `https?://(${Object.keys(PROVIDER_URLS).map((u) => u.replace(/\./g, '\\.')).join('|')})(/[^\\s"'\`]*)`,
  'g'
);

// ─── Environment variable patterns ─────────────────────────────────────────

export const ENV_VAR_MAP: Record<string, string> = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GOOGLE_API_KEY: 'google',
  TOGETHER_API_KEY: 'together',
  MISTRAL_API_KEY: 'mistral',
  COHERE_API_KEY: 'cohere',
  GROQ_API_KEY: 'groq',
  PERPLEXITY_API_KEY: 'perplexity',
  FIREWORKS_API_KEY: 'fireworks',
  DEEPSEEK_API_KEY: 'deepseek',
  REPLICATE_API_TOKEN: 'replicate',
};

const ENV_VAR_NAMES = Object.keys(ENV_VAR_MAP);

export const ENV_VAR_PATTERNS: Array<{ pattern: RegExp; envName: string; provider: string }> = ENV_VAR_NAMES.map(
  (name) => ({
    pattern: new RegExp(`(?:process\\.env\\.${name}|os\\.environ\\[["']${name}["']\\])`, 'g'),
    envName: name,
    provider: ENV_VAR_MAP[name],
  })
);

// Pre-built combined regexes for fast scanning
export const PROCESS_ENV_REGEX = new RegExp(`process\\.env\\.(${ENV_VAR_NAMES.join('|')})`, 'g');
export const OS_ENVIRON_REGEX = new RegExp(`os\\.environ\\[["'](${ENV_VAR_NAMES.join('|')})["']\\]`, 'g');

// ─── Proxy-eligible providers ──────────────────────────────────────────────

export const PROXY_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'together',
  'mistral',
  'cohere',
  'groq',
  'perplexity',
  'fireworks',
  'deepseek',
  'replicate',
]);

// ─── Platform detection ────────────────────────────────────────────────────

export const PLATFORM_FILES: Record<string, string> = {
  'vercel.json': 'Vercel',
  '.vercel/project.json': 'Vercel',
  'railway.toml': 'Railway',
  'railway.json': 'Railway',
  'fly.toml': 'Fly.io',
  'render.yaml': 'Render',
  'netlify.toml': 'Netlify',
  Dockerfile: 'Docker',
  'docker-compose.yml': 'Docker Compose',
  'docker-compose.yaml': 'Docker Compose',
  'heroku.yml': 'Heroku',
  Procfile: 'Heroku',
};

// ─── File filtering ────────────────────────────────────────────────────────

export const SCANNABLE_EXTENSIONS = ['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.rb', '.java', '.php', '.mjs', '.cjs'];
const SCAN_EXTENSIONS_SET = new Set(SCANNABLE_EXTENSIONS);

export const SKIP_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'vendor',
  '__pycache__',
  'coverage',
  '.output',
  '.turbo',
];
const SKIP_DIRS_SET = new Set(SKIP_DIRS);

export const MAX_FILES = 200;
export const MAX_FILE_LINES = 10000;
export const MAX_LINE_LENGTH = 2000;
export const MIN_ENTROPY = 3.5;

// ─── Helper functions ──────────────────────────────────────────────────────

/** Calculate Shannon entropy of a string (bits per character). */
export function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Match a value against known key prefix patterns to identify the provider. */
export function detectProvider(value: string): string | null {
  for (const { pattern, provider } of KEY_PATTERNS) {
    if (pattern.test(value)) return provider;
  }
  return null;
}

/** Determine whether a file path should be scanned based on extension and directory. */
export function shouldScanFile(path: string): boolean {
  const parts = path.split('/');
  const basename = parts[parts.length - 1] || '';
  // .env files are always scannable
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  // Check extension
  const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
  if (!SCAN_EXTENSIONS_SET.has(ext)) return false;
  // Skip known directories
  return !parts.some((p) => SKIP_DIRS_SET.has(p));
}

/** Recommend VaultProof mode based on provider. */
export function recommendMode(provider: string): string {
  return PROXY_PROVIDERS.has(provider) ? 'proxy' : 'env-injection';
}

// ─── Key verification ──────────────────────────────────────────────────────

const VERIFY_ENDPOINTS: Record<string, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
  },
  stripe: {
    url: 'https://api.stripe.com/v1/balance',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  github: {
    url: 'https://api.github.com/user',
    headers: (k) => ({ Authorization: `Bearer ${k}`, 'User-Agent': 'VaultProof-Scanner' }),
  },
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/scopes',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  resend: {
    url: 'https://api.resend.com/api-keys',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
};

/** Test whether a detected key is still active by making a lightweight API call. */
export async function verifyKey(key: string, provider: string): Promise<'active' | 'revoked' | 'unknown'> {
  const endpoint = VERIFY_ENDPOINTS[provider];
  if (!endpoint) return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint.url, {
      method: 'GET',
      headers: endpoint.headers(key),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status < 400 || res.status === 429) return 'active';
    if (res.status === 401 || res.status === 403) return 'revoked';
    return 'unknown';
  } catch {
    clearTimeout(timer);
    return 'unknown';
  }
}

// ─── Provider info (for UI / scan results) ─────────────────────────────────

const ROTATION_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  stripe: 'https://dashboard.stripe.com/apikeys',
  google: 'https://console.cloud.google.com/apis/credentials',
  github: 'https://github.com/settings/tokens',
  aws: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  sendgrid: 'https://app.sendgrid.com/settings/api_keys',
  resend: 'https://resend.com/api-keys',
  supabase: 'https://supabase.com/dashboard/project/_/settings/api',
  slack: 'https://api.slack.com/apps',
  twilio: 'https://console.twilio.com',
  datadog: 'https://app.datadoghq.com/organization-settings/api-keys',
  contentful: 'https://app.contentful.com/account/profile/cma_tokens',
  fauna: 'https://dashboard.fauna.com',
  posthog: 'https://app.posthog.com/project/settings',
};

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  stripe: 'Stripe',
  google: 'Google / Firebase',
  github: 'GitHub',
  aws: 'AWS',
  sendgrid: 'SendGrid',
  resend: 'Resend',
  supabase: 'Supabase',
  slack: 'Slack',
  twilio: 'Twilio',
  datadog: 'Datadog',
  contentful: 'Contentful',
  fauna: 'FaunaDB',
  posthog: 'PostHog',
  together: 'Together AI',
  mistral: 'Mistral AI',
  cohere: 'Cohere',
  groq: 'Groq',
  perplexity: 'Perplexity',
  fireworks: 'Fireworks AI',
  deepseek: 'DeepSeek',
  replicate: 'Replicate',
  brevo: 'Brevo',
  npm: 'npm',
  apollo: 'Apollo',
  neon: 'Neon',
  upstash: 'Upstash',
  mongodb: 'MongoDB',
};

/** Get display name and rotation URL for a provider. */
export function getProviderInfo(provider: string): { name: string; rotationUrl: string } {
  return {
    name: PROVIDER_NAMES[provider] || provider,
    rotationUrl: ROTATION_URLS[provider] || '',
  };
}
