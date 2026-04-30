import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readPolicy(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assertIncludes(name, content, required) {
  const missing = required.filter((value) => !content.includes(value));
  if (missing.length > 0) {
    throw new Error(`${name} is missing required policy content: ${missing.join(', ')}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertHeaderAction(name, content, headerName, action) {
  const pattern = new RegExp(
    `<set-header\\s+name=["']${escapeRegExp(headerName)}["']\\s+exists-action=["']${escapeRegExp(action)}["']`,
    'i',
  );
  if (!pattern.test(content)) {
    throw new Error(`${name} must set ${headerName} with exists-action=${action}`);
  }
}

function assertBalancedPolicyShell(name, content) {
  assertIncludes(name, content, [
    '<policies>',
    '<inbound>',
    '<base />',
    '<backend>',
    '<outbound>',
    '<on-error>',
    '</policies>',
  ]);
}

const providerSecretHeaders = [
  'x-api-key',
  'openai-api-key',
  'anthropic-api-key',
  'stripe-api-key',
];

const certificateCallerLockHeaders = [
  'x-vaultproof-client-cert-thumbprint',
  'x-vaultproof-client-cert-subject',
];

const policies = [
  {
    name: 'VaultProof-managed APIM',
    path: 'docs/enterprise/vaultproof-managed-apim-policy.xml',
    deleteHeaders: [
      ...providerSecretHeaders,
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      ...certificateCallerLockHeaders,
    ],
    overrideHeaders: [
      'x-vaultproof-apim',
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      'x-vaultproof-origin-lock',
    ],
    required: [
      'rate-limit-by-key',
      'quota-by-key',
      'x-vaultproof-origin-lock',
      '{{vaultproof-origin-lock-secret}}',
      'x-api-key',
      'openai-api-key',
      'anthropic-api-key',
      'stripe-api-key',
      '<value>gateway</value>',
      'set-backend-service',
    ],
  },
  {
    name: 'Customer-managed APIM',
    path: 'docs/enterprise/customer-managed-apim-policy.xml',
    deleteHeaders: [
      ...providerSecretHeaders,
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      ...certificateCallerLockHeaders,
    ],
    overrideHeaders: [
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
    ],
    required: [
      'validate-jwt',
      'x-vaultproof-customer-gateway',
      'x-api-key',
      'openai-api-key',
      'anthropic-api-key',
      'stripe-api-key',
      '<value>gateway</value>',
      'set-backend-service base-url="https://enterprise.vaultproof.dev"',
    ],
  },
  {
    name: 'Customer-managed APIM device',
    path: 'docs/enterprise/customer-managed-apim-device-policy.xml',
    deleteHeaders: [
      ...providerSecretHeaders,
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      'x-vaultproof-device-id',
      'x-vaultproof-fleet-id',
      'x-vaultproof-firmware-version',
      ...certificateCallerLockHeaders,
    ],
    overrideHeaders: [
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      'x-vaultproof-device-id',
      'x-vaultproof-fleet-id',
      'x-vaultproof-firmware-version',
      ...certificateCallerLockHeaders,
    ],
    required: [
      'validate-jwt',
      'x-vaultproof-client-class',
      '<value>device</value>',
      'x-vaultproof-device-id',
      'x-vaultproof-fleet-id',
      'x-vaultproof-firmware-version',
      'x-vaultproof-client-cert-thumbprint',
      'x-vaultproof-client-cert-subject',
      'set-backend-service base-url="https://enterprise.vaultproof.dev"',
    ],
  },
  {
    name: 'Customer-managed APIM mTLS',
    path: 'docs/enterprise/customer-managed-apim-mtls-policy.xml',
    deleteHeaders: [
      ...providerSecretHeaders,
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      ...certificateCallerLockHeaders,
    ],
    overrideHeaders: [
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      ...certificateCallerLockHeaders,
    ],
    required: [
      'validate-client-certificate',
      'validate-revocation="true"',
      'validate-trust="true"',
      '{CLIENT_CERT_SHA1_THUMBPRINT_UPPERCASE}',
      'x-vaultproof-customer-gateway',
      'x-vaultproof-client-class',
      '<value>gateway</value>',
      'x-vaultproof-client-cert-thumbprint',
      'context.Request.Certificate.Thumbprint',
      'x-vaultproof-client-cert-subject',
      'context.Request.Certificate.Subject',
      'x-api-key',
      'openai-api-key',
      'anthropic-api-key',
      'stripe-api-key',
      'set-backend-service base-url="https://enterprise.vaultproof.dev"',
    ],
  },
];

for (const policy of policies) {
  const content = readPolicy(policy.path);
  assertBalancedPolicyShell(policy.name, content);
  assertIncludes(policy.name, content, policy.required);
  for (const headerName of policy.deleteHeaders) {
    assertHeaderAction(policy.name, content, headerName, 'delete');
  }
  for (const headerName of policy.overrideHeaders) {
    assertHeaderAction(policy.name, content, headerName, 'override');
  }
}

console.log(JSON.stringify({
  status: 'ok',
  checked: policies.map((policy) => policy.path),
}, null, 2));
