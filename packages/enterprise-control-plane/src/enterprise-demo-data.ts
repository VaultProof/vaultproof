type JsonObject = Record<string, unknown>;

const DEMO_ORG_ID = 'demo-org-northstar-finance';
const DEMO_ORG_SLUG = 'northstar-finance';
const DEMO_TREND_DAYS = 180;

function daysAgoIso(days: number, hourOffset = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  date.setUTCHours(Math.max(0, Math.min(23, 16 - hourOffset)), 20, 0, 0);
  return date.toISOString();
}

function dayKey(daysAgo: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - Math.max(0, daysAgo));
  return date.toISOString().slice(0, 10);
}

function providerSlot(
  id: string,
  provider: string,
  mode: 'sealed-live' | 'demo-placeholder' | 'mixed' | 'missing',
  extra: JsonObject = {},
): JsonObject {
  const seed = Array.from(`${id}:${provider}`).reduce((total, char) => total + char.charCodeAt(0), 0);
  const owners: Record<string, string> = {
    anthropic: 'priya.shah@northstarfinance.example',
    cloudflare: 'luis.romero@northstarfinance.example',
    deepl: 'noah.klein@northstarfinance.example',
    github: 'hana.okafor@northstarfinance.example',
    google: 'luis.romero@northstarfinance.example',
    intercom: 'maya.chen@northstarfinance.example',
    openai: 'priya.shah@northstarfinance.example',
    postmark: 'eli.morgan@northstarfinance.example',
    sendgrid: 'eli.morgan@northstarfinance.example',
    slack: 'luis.romero@northstarfinance.example',
    stripe: 'revenue-ops@northstarfinance.example',
    supabase: 'hana.okafor@northstarfinance.example',
  };
  const recentCalls = 680 + (seed % 42) * 117;
  const deniedCalls = mode === 'demo-placeholder' ? 18 + (seed % 9) : seed % 7;
  const errorCalls = deniedCalls + (mode === 'mixed' ? 12 : seed % 11);
  return {
    key_id: id,
    provider,
    slug: provider,
    material_mode: mode,
    material_ready: mode === 'sealed-live',
    environment: provider === 'supabase' || provider === 'anthropic' ? 'sandbox' : 'production',
    owner_email: owners[provider] || 'platform-oncall@northstarfinance.example',
    rotation_status: mode === 'sealed-live' ? 'current' : mode === 'mixed' ? 'rotating' : 'scheduled',
    rotation_sla: mode === 'sealed-live' ? `${21 + (seed % 24)} days` : `${5 + (seed % 9)} days`,
    policy_status: mode === 'sealed-live' ? 'caller lock enforced' : 'setup review',
    last_used_at: daysAgoIso(seed % 5, seed % 4),
    usage_window_days: 30,
    recent_calls: recentCalls,
    denied_calls: deniedCalls,
    error_calls: errorCalls,
    ...extra,
  };
}

function project(
  id: string,
  name: string,
  role: string,
  origins: string,
  providers: JsonObject[],
  policy: JsonObject,
  daysOld: number,
): JsonObject {
  return {
    id,
    organization_id: DEMO_ORG_ID,
    vp_proj_id: `vp-proj-${id.replace(/^demo-proj-/, '').replace(/-/g, '')}`,
    name,
    allowed_origins: origins,
    strict_origin: true,
    caller_lock_policy: policy,
    created_at: daysAgoIso(daysOld),
    revoked_at: null,
    project_role: role,
    access_via: 'organization',
    provider_slots: providers,
  };
}

function buildCallTrend(): JsonObject[] {
  return Array.from({ length: DEMO_TREND_DAYS }, (_, index) => {
    const daysAgo = DEMO_TREND_DAYS - index - 1;
    const weekendWeight = index % 7 === 5 || index % 7 === 6 ? 0.76 : 1;
    const growth = 780 + index * 17;
    const seasonality = Math.sin(index / 5.5) * 130 + Math.cos(index / 18) * 92;
    const rolloutLift = index > 128 ? 620 : index > 82 ? 310 : index > 44 ? 120 : 0;
    const calls = Math.max(360, Math.round((growth + seasonality + rolloutLift) * weekendWeight));
    const denied = index % 41 === 0 ? 34 : index % 23 === 0 ? 18 : index % 11 === 0 ? 8 : index % 6 === 0 ? 3 : 1;
    const otherErrors = index % 37 === 0 ? 26 : index % 19 === 0 ? 14 : index % 8 === 0 ? 7 : 2;
    return {
      day: dayKey(daysAgo),
      calls,
      denied,
      errors: denied + otherErrors,
    };
  });
}

function sum(rows: JsonObject[], field: string): number {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function buildProjects(): JsonObject[] {
  return [
    project(
      'demo-proj-customer-api',
      'Customer API Gateway',
      'owner',
      'https://app.northstarfinance.example,https://api.northstarfinance.example',
      [
        providerSlot('demo-key-openai-customer-api', 'openai', 'sealed-live'),
        providerSlot('demo-key-stripe-billing-api', 'stripe', 'sealed-live'),
        providerSlot('demo-key-cloudflare-edge', 'cloudflare', 'mixed'),
      ],
      {
        allowed_providers: ['openai', 'stripe', 'cloudflare'],
        allowed_methods: ['GET', 'POST'],
        allowed_upstream_hosts: ['api.openai.com', 'api.stripe.com', 'api.cloudflare.com'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['server', 'worker'],
        rate_limit_per_minute: 420,
      },
      42,
    ),
    project(
      'demo-proj-ai-support',
      'AI Support Agent',
      'admin',
      'https://support.northstarfinance.example',
      [
        providerSlot('demo-key-openai-support', 'openai', 'sealed-live'),
        providerSlot('demo-key-anthropic-support', 'anthropic', 'demo-placeholder'),
        providerSlot('demo-key-intercom-support', 'intercom', 'sealed-live'),
      ],
      {
        allowed_providers: ['openai', 'anthropic', 'intercom'],
        allowed_methods: ['GET', 'POST'],
        allowed_upstream_hosts: ['api.openai.com', 'api.anthropic.com', 'api.intercom.io'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['server'],
        rate_limit_per_minute: 260,
      },
      34,
    ),
    project(
      'demo-proj-billing-automation',
      'Billing Automation',
      'admin',
      'https://billing.northstarfinance.example',
      [
        providerSlot('demo-key-stripe-invoices', 'stripe', 'sealed-live'),
        providerSlot('demo-key-sendgrid-billing', 'sendgrid', 'sealed-live'),
        providerSlot('demo-key-notion-finops', 'notion', 'sealed-live'),
      ],
      {
        allowed_providers: ['stripe', 'sendgrid', 'notion'],
        allowed_methods: ['GET', 'POST'],
        allowed_upstream_hosts: ['api.stripe.com', 'api.sendgrid.com', 'api.notion.com'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['server', 'job'],
        allowed_email_sender_domains: ['northstarfinance.example'],
        allowed_email_recipient_domains: ['northstarfinance.example', 'customer.example'],
        allowed_email_template_ids: ['invoice-ready', 'payment-failed'],
        require_email_template_id: true,
        rate_limit_per_minute: 180,
      },
      31,
    ),
    project(
      'demo-proj-email-notifications',
      'Email Notifications',
      'developer',
      'https://notify.northstarfinance.example',
      [
        providerSlot('demo-key-sendgrid-product', 'sendgrid', 'sealed-live'),
        providerSlot('demo-key-postmark-transactional', 'postmark', 'sealed-live'),
      ],
      {
        allowed_providers: ['sendgrid', 'postmark'],
        allowed_methods: ['POST'],
        allowed_upstream_hosts: ['api.sendgrid.com', 'api.postmarkapp.com'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['server'],
        allowed_email_sender_domains: ['northstarfinance.example'],
        allowed_email_recipient_domains: ['northstarfinance.example', 'customer.example'],
        allowed_email_template_ids: ['welcome', 'risk-alert', 'statement-ready'],
        require_email_template_id: true,
        rate_limit_per_minute: 520,
      },
      29,
    ),
    project(
      'demo-proj-localization',
      'Localization Service',
      'developer',
      'https://content.northstarfinance.example',
      [
        providerSlot('demo-key-deepl-localization', 'deepl', 'sealed-live'),
        providerSlot('demo-key-google-translate', 'google', 'mixed'),
      ],
      {
        allowed_providers: ['deepl', 'google'],
        allowed_methods: ['GET', 'POST'],
        allowed_upstream_hosts: ['api-free.deepl.com', 'translation.googleapis.com'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['worker', 'job'],
        rate_limit_per_minute: 140,
      },
      24,
    ),
    project(
      'demo-proj-analytics-pipeline',
      'Analytics Pipeline',
      'operator',
      'https://analytics.northstarfinance.example',
      [
        providerSlot('demo-key-google-analytics', 'google', 'sealed-live'),
        providerSlot('demo-key-sentry-observability', 'sentry', 'sealed-live'),
        providerSlot('demo-key-slack-alerts', 'slack', 'sealed-live'),
      ],
      {
        allowed_providers: ['google', 'sentry', 'slack'],
        allowed_methods: ['GET', 'POST'],
        allowed_upstream_hosts: ['analyticsdata.googleapis.com', 'sentry.io', 'slack.com'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['job', 'server'],
        rate_limit_per_minute: 240,
      },
      18,
    ),
    project(
      'demo-proj-security-automation',
      'Security Automation',
      'security_admin',
      'https://security.northstarfinance.example',
      [
        providerSlot('demo-key-github-security', 'github', 'sealed-live'),
        providerSlot('demo-key-cloudflare-waf', 'cloudflare', 'sealed-live'),
        providerSlot('demo-key-supabase-admin', 'supabase', 'demo-placeholder'),
      ],
      {
        allowed_providers: ['github', 'cloudflare', 'supabase'],
        allowed_methods: ['GET', 'POST', 'PATCH'],
        allowed_upstream_hosts: ['api.github.com', 'api.cloudflare.com', 'gwzkjiomemjlhtrdrlan.supabase.co'],
        allowed_customer_gateways: ['vaultproof-managed'],
        allowed_client_classes: ['server', 'job'],
        rate_limit_per_minute: 120,
      },
      13,
    ),
  ];
}

function buildProjectHealth(): JsonObject[] {
  return [
    { project_id: 'demo-proj-customer-api', name: 'Customer API Gateway', calls: 11640, denied: 18, errors: 72, lastActivity: daysAgoIso(0, 0) },
    { project_id: 'demo-proj-ai-support', name: 'AI Support Agent', calls: 10280, denied: 46, errors: 118, lastActivity: daysAgoIso(0, 1) },
    { project_id: 'demo-proj-billing-automation', name: 'Billing Automation', calls: 6940, denied: 7, errors: 34, lastActivity: daysAgoIso(0, 3) },
    { project_id: 'demo-proj-email-notifications', name: 'Email Notifications', calls: 8348, denied: 5, errors: 27, lastActivity: daysAgoIso(1, 1) },
    { project_id: 'demo-proj-localization', name: 'Localization Service', calls: 4212, denied: 2, errors: 9, lastActivity: daysAgoIso(1, 2) },
    { project_id: 'demo-proj-analytics-pipeline', name: 'Analytics Pipeline', calls: 5168, denied: 11, errors: 43, lastActivity: daysAgoIso(1, 4) },
    { project_id: 'demo-proj-security-automation', name: 'Security Automation', calls: 2542, denied: 9, errors: 15, lastActivity: daysAgoIso(2, 0) },
  ];
}

function buildRecentActivity(): JsonObject[] {
  return [
    {
      id: 'demo-audit-proxy-openai-1',
      source: 'proxy',
      event_type: 'proxy_request',
      action: 'proxy.allowed',
      status: 200,
      description: 'OpenAI customer-summary request allowed',
      actor: 'api-gateway@northstarfinance.example',
      actor_email: 'api-gateway@northstarfinance.example',
      timestamp: daysAgoIso(0, 0),
      created_at: daysAgoIso(0, 0),
      project: { id: 'demo-proj-customer-api', name: 'Customer API Gateway', vp_proj_id: 'vp-proj-customerapi' },
      keySlot: { provider: 'openai', slug: 'openai' },
      metadata: { provider: 'openai', slug: 'openai', status_code: 200, latency_ms: 182, api_protocol: 'rest', provider_request_id: 'req_demo_87f3' },
    },
    {
      id: 'demo-audit-proxy-anthropic-denied',
      source: 'proxy',
      event_type: 'proxy_request',
      action: 'proxy.denied',
      status: 403,
      description: 'Anthropic agent request blocked by placeholder-material gate',
      actor: 'support-agent@northstarfinance.example',
      actor_email: 'support-agent@northstarfinance.example',
      timestamp: daysAgoIso(0, 1),
      created_at: daysAgoIso(0, 1),
      project: { id: 'demo-proj-ai-support', name: 'AI Support Agent', vp_proj_id: 'vp-proj-aisupport' },
      keySlot: { provider: 'anthropic', slug: 'anthropic' },
      metadata: { provider: 'anthropic', slug: 'anthropic', status_code: 403, latency_ms: 41, denial_reason: 'placeholder material', api_protocol: 'rest' },
    },
    {
      id: 'demo-audit-proxy-stripe-1',
      source: 'proxy',
      event_type: 'proxy_request',
      action: 'proxy.allowed',
      status: 200,
      description: 'Stripe invoice lookup completed through protected slot',
      actor: 'billing-job@northstarfinance.example',
      actor_email: 'billing-job@northstarfinance.example',
      timestamp: daysAgoIso(0, 2),
      created_at: daysAgoIso(0, 2),
      project: { id: 'demo-proj-billing-automation', name: 'Billing Automation', vp_proj_id: 'vp-proj-billingautomation' },
      keySlot: { provider: 'stripe', slug: 'stripe' },
      metadata: { provider: 'stripe', slug: 'stripe', status_code: 200, latency_ms: 236, api_protocol: 'rest', provider_request_id: 'req_demo_4c91' },
    },
    {
      id: 'demo-audit-proxy-email-denied',
      source: 'proxy',
      event_type: 'proxy_request',
      action: 'proxy.denied',
      status: 429,
      description: 'SendGrid burst held by per-minute policy',
      actor: 'notify-worker@northstarfinance.example',
      actor_email: 'notify-worker@northstarfinance.example',
      timestamp: daysAgoIso(1, 1),
      created_at: daysAgoIso(1, 1),
      project: { id: 'demo-proj-email-notifications', name: 'Email Notifications', vp_proj_id: 'vp-proj-emailnotifications' },
      keySlot: { provider: 'sendgrid', slug: 'sendgrid' },
      metadata: { provider: 'sendgrid', slug: 'sendgrid', status_code: 429, latency_ms: 28, denial_reason: 'rate limit', api_protocol: 'rest' },
    },
    {
      id: 'demo-audit-proxy-deepl-1',
      source: 'proxy',
      event_type: 'proxy_request',
      action: 'proxy.allowed',
      status: 200,
      description: 'DeepL translation batch finished',
      actor: 'content-worker@northstarfinance.example',
      actor_email: 'content-worker@northstarfinance.example',
      timestamp: daysAgoIso(1, 2),
      created_at: daysAgoIso(1, 2),
      project: { id: 'demo-proj-localization', name: 'Localization Service', vp_proj_id: 'vp-proj-localization' },
      keySlot: { provider: 'deepl', slug: 'deepl' },
      metadata: { provider: 'deepl', slug: 'deepl', status_code: 200, latency_ms: 391, api_protocol: 'rest' },
    },
    {
      id: 'demo-audit-proxy-google-review',
      source: 'proxy',
      event_type: 'proxy_error',
      action: 'proxy.error',
      status: 502,
      description: 'Google analytics request returned upstream retryable error',
      actor: 'analytics-job@northstarfinance.example',
      actor_email: 'analytics-job@northstarfinance.example',
      timestamp: daysAgoIso(2, 0),
      created_at: daysAgoIso(2, 0),
      project: { id: 'demo-proj-analytics-pipeline', name: 'Analytics Pipeline', vp_proj_id: 'vp-proj-analyticspipeline' },
      keySlot: { provider: 'google', slug: 'google' },
      metadata: { provider: 'google', slug: 'google', status_code: 502, latency_ms: 804, api_protocol: 'rest', retryable: true },
    },
  ];
}

function buildOverview(): JsonObject {
  const callTrend = buildCallTrend();
  const totalCalls = sum(callTrend, 'calls');
  const deniedCalls = sum(callTrend, 'denied');
  const errorCalls = sum(callTrend, 'errors');
  const otherErrorCalls = Math.max(errorCalls - deniedCalls, 0);
  const projects = buildProjects();

  return {
    totalProjects: projects.length,
    totalKeys: 19,
    providers: ['openai', 'anthropic', 'stripe', 'sendgrid', 'postmark', 'deepl', 'google', 'github', 'cloudflare', 'supabase', 'slack', 'sentry', 'intercom', 'notion'],
    providerCount: 14,
    activeApps: projects.length,
    totalCalls,
    errorCalls,
    deniedCalls,
    errorRate: totalCalls ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0,
    healthWindowDays: DEMO_TREND_DAYS,
    statsSource: 'sample_dashboard',
    accessLogStatsSource: 'sample_dashboard',
    sampleWorkspace: 'northstar_finance_group',
    providerSlotSummary: {
      totalSlots: 19,
      liveSealedSlots: 16,
      placeholderSlots: 2,
      mixedSlots: 1,
      missingSlots: 0,
    },
    providerUsage: [
      { provider: 'openai', labels: ['Customer API Gateway', 'AI Support Agent'], slots: 2, liveSealedSlots: 2, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 9360, denied: 10, errors: 42, lastActivity: daysAgoIso(0, 0) },
      { provider: 'stripe', labels: ['Customer API Gateway', 'Billing Automation'], slots: 2, liveSealedSlots: 2, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 7168, denied: 7, errors: 34, lastActivity: daysAgoIso(0, 2) },
      { provider: 'sendgrid', labels: ['Billing Automation', 'Email Notifications'], slots: 2, liveSealedSlots: 2, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 6218, denied: 5, errors: 19, lastActivity: daysAgoIso(1, 1) },
      { provider: 'anthropic', labels: ['AI Support Agent'], slots: 1, liveSealedSlots: 0, placeholderSlots: 1, mixedSlots: 0, missingSlots: 0, recentCalls: 2880, denied: 46, errors: 61, lastActivity: daysAgoIso(0, 1) },
      { provider: 'google', labels: ['Localization Service', 'Analytics Pipeline'], slots: 2, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 1, missingSlots: 0, recentCalls: 4676, denied: 13, errors: 52, lastActivity: daysAgoIso(1, 4) },
      { provider: 'deepl', labels: ['Localization Service'], slots: 1, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 3214, denied: 2, errors: 9, lastActivity: daysAgoIso(1, 2) },
      { provider: 'cloudflare', labels: ['Customer API Gateway', 'Security Automation'], slots: 2, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 1, missingSlots: 0, recentCalls: 2248, denied: 9, errors: 21, lastActivity: daysAgoIso(2, 0) },
      { provider: 'postmark', labels: ['Email Notifications'], slots: 1, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 2130, denied: 0, errors: 8, lastActivity: daysAgoIso(1, 0) },
      { provider: 'github', labels: ['Security Automation'], slots: 1, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 1526, denied: 3, errors: 7, lastActivity: daysAgoIso(2, 1) },
      { provider: 'supabase', labels: ['Security Automation'], slots: 1, liveSealedSlots: 0, placeholderSlots: 1, mixedSlots: 0, missingSlots: 0, recentCalls: 540, denied: 6, errors: 8, lastActivity: daysAgoIso(3, 0) },
    ],
    trafficBreakdown: {
      totalCalls,
      okCalls: Math.max(totalCalls - errorCalls, 0),
      deniedCalls,
      errorCalls,
      otherErrorCalls,
    },
    apiProtocolBreakdown: {
      rest: Math.round(totalCalls * 0.82),
      graphql: Math.round(totalCalls * 0.18),
      unknown: 0,
    },
    projectCoverage: {
      totalProjects: projects.length,
      withProviderSlots: projects.length,
      withoutProviderSlots: 0,
      withTraffic: projects.length,
      needingAttention: 3,
    },
    callTrend,
    projectHealth: buildProjectHealth(),
    alerts: [
      { severity: 'warning', title: 'Anthropic slot is still demo-only', detail: 'Replace placeholder material before production support-agent traffic uses Anthropic.' },
      { severity: 'warning', title: 'Cloudflare edge slot is mixed', detail: 'One edge token still needs final rotation after the WAF policy test.' },
      { severity: 'info', title: 'DeepL translation usage is protected', detail: 'Localization traffic is visible in the provider map without exposing the upstream DeepL key.' },
      { severity: 'info', title: 'Stripe and email flows are protected', detail: 'Billing and notification calls are routing through live sealed provider slots.' },
      { severity: 'info', title: 'Scanner remediation is moving', detail: 'Two redacted findings are in rotation and one has been closed as a false positive.' },
    ],
    pilotReview: {
      headline: 'Northstar Finance sample workspace',
    },
    recentActivity: buildRecentActivity(),
  };
}

function buildOrganizations(): JsonObject[] {
  return [{
    id: DEMO_ORG_ID,
    name: 'Northstar Finance Group',
    slug: DEMO_ORG_SLUG,
    kind: 'team',
    role: 'owner',
    is_active: true,
  }];
}

function projectAccess(projectId: string, role: string): JsonObject {
  return {
    project_id: projectId,
    project_name: buildProjects().find((item) => item.id === projectId)?.name || projectId,
    vp_proj_id: buildProjects().find((item) => item.id === projectId)?.vp_proj_id || projectId,
    role,
  };
}

function buildMembersPayload(): JsonObject {
  const projects = buildProjects();
  const organization = {
    id: DEMO_ORG_ID,
    name: 'Northstar Finance Group',
    slug: DEMO_ORG_SLUG,
    kind: 'team',
    role: 'owner',
    can_manage_members: true,
    can_archive: true,
    member_count: 8,
    project_count: projects.length,
  };

  return {
    organization,
    sso_status: {
      provider_status: 'configured',
      login_mode: 'company_sso',
      provider: 'Microsoft Entra ID',
      last_membership_resolution: 'matched_domain',
      last_membership_resolution_email: 'maya.chen@northstarfinance.example',
    },
    members: [
      { user_id: 'demo-user-maya', email: 'maya.chen@northstarfinance.example', role: 'owner', created_at: daysAgoIso(41), project_access: [projectAccess('demo-proj-customer-api', 'owner'), projectAccess('demo-proj-security-automation', 'owner')] },
      { user_id: 'demo-user-luis', email: 'luis.romero@northstarfinance.example', role: 'platform_admin', created_at: daysAgoIso(36), project_access: [projectAccess('demo-proj-customer-api', 'project_admin'), projectAccess('demo-proj-analytics-pipeline', 'operator')] },
      { user_id: 'demo-user-priya', email: 'priya.shah@northstarfinance.example', role: 'security_admin', created_at: daysAgoIso(35), project_access: [projectAccess('demo-proj-security-automation', 'project_admin'), projectAccess('demo-proj-ai-support', 'auditor')] },
      { user_id: 'demo-user-eli', email: 'eli.morgan@northstarfinance.example', role: 'developer', created_at: daysAgoIso(30), project_access: [projectAccess('demo-proj-ai-support', 'developer'), projectAccess('demo-proj-email-notifications', 'developer')] },
      { user_id: 'demo-user-hana', email: 'hana.okafor@northstarfinance.example', role: 'auditor', created_at: daysAgoIso(26), project_access: [projectAccess('demo-proj-billing-automation', 'auditor'), projectAccess('demo-proj-analytics-pipeline', 'auditor')] },
      { user_id: 'demo-user-noah', email: 'noah.klein@northstarfinance.example', role: 'developer', created_at: daysAgoIso(21), project_access: [projectAccess('demo-proj-localization', 'developer')] },
      { user_id: 'demo-user-sofia', email: 'sofia.alvarez@northstarfinance.example', role: 'iam_admin', created_at: daysAgoIso(20), project_access: [] },
      { user_id: 'demo-user-jin', email: 'jin.park@northstarfinance.example', role: 'viewer', created_at: daysAgoIso(15), project_access: [projectAccess('demo-proj-analytics-pipeline', 'viewer')] },
    ],
    invitations: [
      { id: 'demo-invite-rhea', email: 'rhea.patel@northstarfinance.example', role: 'developer', status: 'pending', created_at: daysAgoIso(2) },
      { id: 'demo-invite-omar', email: 'omar.wright@northstarfinance.example', role: 'auditor', status: 'pending', created_at: daysAgoIso(4) },
    ],
    pending_invitations_for_me: [],
    projects,
  };
}

function buildAuditPayload(): JsonObject {
  const governanceEvents: JsonObject[] = [
    {
      id: 'demo-audit-policy-updated',
      source: 'governance',
      event_type: 'project_policy_updated',
      actor: 'priya.shah@northstarfinance.example',
      actor_email: 'priya.shah@northstarfinance.example',
      description: 'Updated caller-lock policy for AI Support Agent to require VaultProof-managed gateway and server client class.',
      timestamp: daysAgoIso(0, 3),
      created_at: daysAgoIso(0, 3),
      project: { id: 'demo-proj-ai-support', name: 'AI Support Agent', vp_proj_id: 'vp-proj-aisupport' },
      metadata: { changed_fields: ['allowed_customer_gateways', 'allowed_client_classes', 'rate_limit_per_minute'], approval: 'SEC-1842' },
    },
    {
      id: 'demo-audit-slot-sealed',
      source: 'governance',
      event_type: 'enterprise_provider_key_sealed',
      actor: 'luis.romero@northstarfinance.example',
      actor_email: 'luis.romero@northstarfinance.example',
      description: 'Sealed Postmark transactional email provider slot after rotation.',
      timestamp: daysAgoIso(1, 0),
      created_at: daysAgoIso(1, 0),
      project: { id: 'demo-proj-email-notifications', name: 'Email Notifications', vp_proj_id: 'vp-proj-emailnotifications' },
      metadata: { provider: 'postmark', material_mode: 'sealed-live', ticket: 'PLAT-3391' },
    },
    {
      id: 'demo-audit-member-invited',
      source: 'governance',
      event_type: 'organization_invitation_created',
      actor: 'sofia.alvarez@northstarfinance.example',
      actor_email: 'sofia.alvarez@northstarfinance.example',
      description: 'Invited procurement reviewer for access-review and evidence walkthrough.',
      timestamp: daysAgoIso(2, 2),
      created_at: daysAgoIso(2, 2),
      metadata: { invitee_role: 'auditor', invitation_status: 'pending' },
    },
    {
      id: 'demo-audit-release-recorded',
      source: 'governance',
      event_type: 'release_evidence_recorded',
      actor: 'maya.chen@northstarfinance.example',
      actor_email: 'maya.chen@northstarfinance.example',
      description: 'Approved canary release evidence for the first customer API workload.',
      timestamp: daysAgoIso(3, 0),
      created_at: daysAgoIso(3, 0),
      metadata: { build_tag: 'enterprise-demo-2026-06-05', rollout_status: 'canary' },
    },
  ];
  const events = [...buildRecentActivity(), ...governanceEvents]
    .sort((a, b) => String(b.timestamp || b.created_at || '').localeCompare(String(a.timestamp || a.created_at || '')));

  return {
    organization: { id: DEMO_ORG_ID, name: 'Northstar Finance Group' },
    filters: { days: 30 },
    summary: {
      totalEvents: events.length,
      governanceEvents: events.filter((event) => event.source === 'governance').length,
      proxyEvents: events.filter((event) => event.source === 'proxy').length,
    },
    events,
    has_more: false,
    next_before: null,
  };
}

function buildAlertsPayload(): JsonObject {
  return {
    can_manage: true,
    policy: {
      dispatch_enabled: true,
      minimum_severity: 'warning',
      min_interval_minutes: 15,
    },
    dispatch_status: {
      cooldown_active: false,
      next_eligible_at: daysAgoIso(0, 0),
    },
    destinations: [
      { id: 'demo-alert-secops-email', label: 'Security operations email', channel_type: 'email', target_masked: 'secops@northstarfinance.example', enabled: true, created_at: daysAgoIso(31), updated_at: daysAgoIso(1) },
      { id: 'demo-alert-platform-webhook', label: 'Platform Slack webhook', channel_type: 'webhook', target_masked: 'https://hooks.slack.com/.../vaultproof', enabled: true, created_at: daysAgoIso(28), updated_at: daysAgoIso(3) },
      { id: 'demo-alert-compliance-email', label: 'Compliance mailbox', channel_type: 'email', target_masked: 'compliance@northstarfinance.example', enabled: false, created_at: daysAgoIso(18), updated_at: daysAgoIso(9) },
    ],
    delivery_logs: [
      { id: 'demo-delivery-1', delivery_kind: 'policy_dispatch', channel_type: 'email', status: 'delivered', detail: 'Anthropic placeholder material warning delivered to security operations.', response_status: 202, delivered_at: daysAgoIso(0, 2) },
      { id: 'demo-delivery-2', delivery_kind: 'policy_dispatch', channel_type: 'webhook', status: 'delivered', detail: 'Cloudflare mixed-material review posted to platform channel.', response_status: 200, delivered_at: daysAgoIso(1, 1) },
      { id: 'demo-delivery-3', delivery_kind: 'test_send', channel_type: 'email', status: 'delivered', detail: 'Weekly alert test sent before guided customer walkthrough.', response_status: 202, delivered_at: daysAgoIso(2, 3) },
      { id: 'demo-delivery-4', delivery_kind: 'policy_dispatch', channel_type: 'email', status: 'skipped', detail: 'Compliance mailbox disabled during pilot.', response_status: null, delivered_at: daysAgoIso(3, 2) },
    ],
    delivery_logs_meta: { total: 4, next_before: null, filters: { activity_window: '7d' } },
    dispatch_runs: [
      { id: 'demo-run-1', trigger_source: 'scheduled', status: 'dispatched', reason: 'provider slot attention signals', checked_at: daysAgoIso(0, 2), dispatched_alert_count: 2, destination_count: 2, delivered_count: 2, failed_count: 0, skipped_count: 1 },
      { id: 'demo-run-2', trigger_source: 'manual', status: 'dispatched', reason: 'pre-walkthrough test send', checked_at: daysAgoIso(2, 3), dispatched_alert_count: 1, destination_count: 1, delivered_count: 1, failed_count: 0, skipped_count: 0 },
      { id: 'demo-run-3', trigger_source: 'scheduled', status: 'skipped', reason: 'cooldown window active', checked_at: daysAgoIso(4, 0), dispatched_alert_count: 0, destination_count: 2, delivered_count: 0, failed_count: 0, skipped_count: 2 },
    ],
    dispatch_runs_meta: { total: 3, next_before: null, filters: { activity_window: '7d' } },
  };
}

function buildScannerFindings(): JsonObject[] {
  return [
    {
      id: 'demo-scanner-openai-env',
      repository: 'northstar/api-gateway',
      branch: 'main',
      finding_type: 'env_file',
      secret_family: 'openai',
      severity: 'high',
      status: 'rotating',
      owner: 'priya.shah@northstarfinance.example',
      provider_slot: 'openai',
      evidence_ref: 'redacted path apps/api/.env.example: OPENAI key pattern, ticket SEC-1847',
      note: 'Upstream key rotated and routed behind Customer API Gateway provider slot. Awaiting final env cleanup PR.',
      created_at: daysAgoIso(5),
      updated_at: daysAgoIso(1),
    },
    {
      id: 'demo-scanner-sendgrid-ci',
      repository: 'northstar/notifications',
      branch: 'release/statement-emails',
      finding_type: 'provider_key',
      secret_family: 'sendgrid',
      severity: 'critical',
      status: 'rotating',
      owner: 'eli.morgan@northstarfinance.example',
      provider_slot: 'sendgrid',
      evidence_ref: 'scanner finding SG-2026-017, masked sample only, PR 482',
      note: 'Live sends are held to allowlist while a new SendGrid key is sealed into VaultProof.',
      created_at: daysAgoIso(4),
      updated_at: daysAgoIso(0, 4),
    },
    {
      id: 'demo-scanner-slack-webhook',
      repository: 'northstar/analytics-pipeline',
      branch: 'main',
      finding_type: 'webhook_secret',
      secret_family: 'slack',
      severity: 'medium',
      status: 'accepted_demo',
      owner: 'luis.romero@northstarfinance.example',
      provider_slot: 'slack',
      evidence_ref: 'ticket PLAT-3419, old webhook replaced with VaultProof-protected alert route',
      note: 'Accepted for pilot because old webhook is disabled and route is read-only for alert delivery.',
      created_at: daysAgoIso(7),
      updated_at: daysAgoIso(2),
    },
    {
      id: 'demo-scanner-false-positive',
      repository: 'northstar/security-automation',
      branch: 'main',
      finding_type: 'other',
      secret_family: 'github',
      severity: 'low',
      status: 'false_positive',
      owner: 'hana.okafor@northstarfinance.example',
      provider_slot: 'github',
      evidence_ref: 'SEC-1829 masked fixture value in unit test',
      note: 'Confirmed as a non-secret fixture. No rotation needed.',
      created_at: daysAgoIso(9),
      updated_at: daysAgoIso(3),
    },
  ];
}

function buildManualApiKeys(): JsonObject {
  return {
    'demo-manual-key-hubspot': {
      provider: 'hubspot',
      key_label: 'HubSpot enrichment API',
      key_reference: 'fingerprint hsp-demo-42',
      key_location: '1Password shared vault, pending migration',
      upstream_scope: 'https://api.hubapi.com/crm/v3',
      business_owner: 'revenue-ops@northstarfinance.example',
      technical_owner: 'eli.morgan@northstarfinance.example',
      business_service: 'Revenue Operations',
      data_sensitivity: 'customer metadata',
      risk: 'medium',
      environment: 'production',
      rotation_status: 'scheduled',
      review_status: 'needs_review',
      next_review_date: dayKey(14),
      source: 'vaultproof_inventory_import',
      source_format: 'csv',
      source_detail: 'Q2 SaaS vendor inventory',
      imported_at: daysAgoIso(3),
      created_at: daysAgoIso(3),
      updated_at: daysAgoIso(1),
    },
    'demo-manual-key-twilio': {
      provider: 'twilio',
      key_label: 'SMS verification API',
      key_reference: 'fingerprint twl-demo-81',
      key_location: 'AWS Secrets Manager, us-east-1',
      upstream_scope: 'https://api.twilio.com/2010-04-01',
      business_owner: 'product@northstarfinance.example',
      technical_owner: 'noah.klein@northstarfinance.example',
      business_service: 'Account Verification',
      data_sensitivity: 'phone numbers',
      risk: 'high',
      environment: 'production',
      rotation_status: 'in_progress',
      review_status: 'blocked',
      next_review_date: dayKey(5),
      source: 'vaultproof_inventory_import',
      source_format: 'openapi',
      source_detail: 'OpenAPI security scheme BasicAuth',
      imported_at: daysAgoIso(6),
      created_at: daysAgoIso(6),
      updated_at: daysAgoIso(2),
    },
  };
}

function buildReleaseRecords(): JsonObject[] {
  return [
    {
      id: 'demo-release-canary',
      release_label: 'Northstar customer API canary',
      build_tag: 'enterprise-demo-2026-06-05-d65da5a6',
      change_summary: 'Customer API Gateway routed OpenAI and Stripe calls through live sealed VaultProof provider slots.',
      approver: 'maya.chen@northstarfinance.example',
      verifier: 'luis.romero@northstarfinance.example',
      verification_status: 'passed',
      rollout_status: 'canary',
      rollback_owner: 'platform-oncall@northstarfinance.example',
      rollback_path: 'Return Customer API Gateway provider map to previous VaultProof slot set and pause edge route if errors exceed 2%.',
      evidence_note: 'Smoke checks, dry-run proxy self-test, activity feed, and audit export reviewed for customer-safe handoff.',
      created_at: daysAgoIso(3),
      updated_at: daysAgoIso(1),
    },
    {
      id: 'demo-release-email',
      release_label: 'Protected email dry-run rollout',
      build_tag: 'notifications-2026-06-03-b7c14f2',
      change_summary: 'SendGrid and Postmark dry-run paths moved behind VaultProof with recipient allowlist evidence.',
      approver: 'priya.shah@northstarfinance.example',
      verifier: 'eli.morgan@northstarfinance.example',
      verification_status: 'accepted_demo',
      rollout_status: 'planned',
      rollback_owner: 'notifications-oncall@northstarfinance.example',
      rollback_path: 'Disable VaultProof email provider slots and keep existing sandbox-only send path active.',
      evidence_note: 'Blocked-recipient policy evidence captured; live email remains gated until scanner rotation closes.',
      created_at: daysAgoIso(5),
      updated_at: daysAgoIso(2),
    },
  ];
}

function buildPilotTesters(): JsonObject[] {
  return [
    { id: 'demo-tester-maya', tester_name: 'Maya Chen', team: 'Security leadership', role: 'executive_sponsor', scenario: 'security_review', status: 'feedback_received', owner: 'VaultProof success', blocker: '', feedback: 'Wants the evidence packet to lead with no raw key exposure and fast revoke story.', created_at: daysAgoIso(7), updated_at: daysAgoIso(1) },
    { id: 'demo-tester-luis', tester_name: 'Luis Romero', team: 'Platform engineering', role: 'platform_admin', scenario: 'api_proxy_self_test', status: 'scenario_passed', owner: 'VaultProof engineering', blocker: '', feedback: 'Dry-run request and activity/audit trail were clear. Asked for GCP KMS notes.', created_at: daysAgoIso(6), updated_at: daysAgoIso(1) },
    { id: 'demo-tester-priya', tester_name: 'Priya Shah', team: 'Application security', role: 'security_reviewer', scenario: 'provider_slot_review', status: 'complete', owner: 'VaultProof security', blocker: '', feedback: 'Approved phased rollout if Anthropic placeholder is replaced before live support traffic.', created_at: daysAgoIso(6), updated_at: daysAgoIso(0, 5) },
    { id: 'demo-tester-hana', tester_name: 'Hana Okafor', team: 'Compliance', role: 'procurement', scenario: 'evidence_review', status: 'invited', owner: 'VaultProof success', blocker: 'Needs access-review CSV during procurement review.', feedback: '', created_at: daysAgoIso(3), updated_at: daysAgoIso(2) },
  ];
}

function buildReadiness(): JsonObject {
  return {
    status: 'ok',
    hostname: 'enterprise.vaultproof.dev',
    runtime_tier: 'dedicated-production',
    customer_dedicated_runtime: true,
    demo_ready: true,
    production_ready: true,
    security_profile: 'confidential-production',
    detail: 'sample workspace',
    control_plane: {
      cloud_provider: 'gcp',
      executor_configured: true,
      supabase_configured: true,
      signing_configured: true,
      origin_lock_configured: true,
      origin_lock_required: true,
      custom_origin_lock_configured: true,
    },
    executor: {
      reachable: true,
      status: 200,
      health: {
        status: 'ok',
        service: 'vaultproof-enterprise-secure-executor',
        secure_execution_ready: true,
        signature_verification_ready: true,
        execution_material_resolver_ready: true,
        key_release_ready: true,
        key_release_mode: 'customer-kms',
        attestation_evidence_ready: true,
        replay_protection_ready: true,
        production_ready: true,
        security_profile: 'confidential-production',
        production_blocker_count: 0,
      },
      error: null,
    },
    demo_blockers: [],
    production_blockers: [],
  };
}

export function buildEnterpriseDemoWorkspaceSnapshot(): JsonObject {
  const projects = buildProjects();
  const organizations = buildOrganizations();
  const overview = buildOverview();
  const membersPayload = buildMembersPayload();

  return {
    sample_data: true,
    label: 'Northstar Finance Group sample workspace',
    bootstrap: {
      organizations,
      active_organization_id: DEMO_ORG_ID,
      projects,
      overview,
      proxy_access_policy_schema_ready: true,
      proxy_access_summary: {
        enabled: true,
        mode: 'vaultproof-managed',
        allowed_gateways: ['vaultproof-managed'],
      },
      proxy_access_checklist: [
        { label: 'Company gateway selected', ok: true },
        { label: 'Caller lock configured', ok: true },
        { label: 'Emergency revoke tested', ok: true },
      ],
    },
    organizationPayload: {
      organization: membersPayload.organization,
      sso_status: membersPayload.sso_status,
    },
    organizationsPayload: {
      organizations,
      active_organization_id: DEMO_ORG_ID,
    },
    projectsPayload: {
      projects,
    },
    membersPayload,
    auditPayload: buildAuditPayload(),
    alertsPayload: buildAlertsPayload(),
    readiness: buildReadiness(),
    manualApiKeys: buildManualApiKeys(),
    scannerFindings: buildScannerFindings(),
    releaseRecords: buildReleaseRecords(),
    pilotTesters: buildPilotTesters(),
    pilotTesterSession: {
      status: 'scheduled',
      session_window: 'June 12, 2026, 10:00 AM ET',
      facilitator: 'VaultProof success',
      customer_owner: 'Maya Chen',
      success_criteria: 'Prove protected provider calls, no raw key exposure, clear revoke path, and exportable evidence for the first workload.',
      customer_action: 'Confirm Anthropic replacement key and access-review CSV before live support-agent traffic.',
      session_note: 'Use Customer API Gateway first, then expand to AI Support Agent after placeholder material is replaced.',
      updated_at: daysAgoIso(1),
    },
  };
}

export function enterpriseDemoWorkspaceJson(): string {
  return JSON.stringify(buildEnterpriseDemoWorkspaceSnapshot()).replace(/</g, '\\u003c');
}
