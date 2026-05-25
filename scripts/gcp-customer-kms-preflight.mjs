#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function printUsageAndExit() {
  console.log(`VaultProof GCP customer-managed KMS preflight

Required:
  CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE or GCP_KMS_CRYPTO_KEY_RESOURCE

Optional:
  VAULT_UNWRAP_KEY_BASE64 or VAULT_UNWRAP_KEY_HEX
  VAULT_UNWRAP_KEY_FILE
  CUSTOMER_GCP_KMS_KEY_VERSION or GCP_KMS_KEY_VERSION
  CUSTOMER_GCP_RUNTIME_SERVICE_ACCOUNT_EMAIL or GCP_SERVICE_ACCOUNT_EMAIL
  REQUIRE_RUNTIME_KMS_IAM=true
  OUTPUT_FORMAT=json|env

Examples:
  CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE="projects/acme-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap" \\
  npm run preflight:gcp-customer-kms

  CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE="projects/acme-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap" \\
  VAULT_UNWRAP_KEY_BASE64="..." \\
  OUTPUT_FORMAT=env \\
  npm run preflight:gcp-customer-kms
`);
  process.exit(0);
}

function parseKmsResource(resource) {
  const trimmed = String(resource || '').trim();
  const match = trimmed.match(/^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)\/cryptoKeys\/([^/]+)(?:\/cryptoKeyVersions\/([^/]+))?$/);
  if (!match) {
    throw new Error('KMS resource must look like projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>.');
  }
  const [, projectId, location, keyRing, keyName, keyVersion] = match;
  return {
    projectId,
    location,
    keyRing,
    keyName,
    keyVersion: keyVersion || '',
    cryptoKeyResource: `projects/${projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${keyName}`,
  };
}

function normalizeRuntimeMember(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z]+:/.test(trimmed)) return trimmed;
  return `serviceAccount:${trimmed}`;
}

function runGcloud(args, options = {}) {
  const result = spawnSync('gcloud', args, {
    cwd: root,
    encoding: options.encoding || 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(output || `gcloud ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout || '';
}

function runGcloudJson(args) {
  const output = runGcloud([...args, '--format=json']);
  return JSON.parse(output);
}

function decodeRootFromText(value, source) {
  const text = String(value || '').trim();
  if (!text) return null;
  const looksHex = /^[0-9a-fA-F]{64}$/.test(text);
  const decoded = looksHex ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (decoded.length !== 32) {
    throw new Error(`${source} must decode to exactly 32 bytes.`);
  }
  return decoded;
}

async function readVaultUnwrapRoot() {
  const direct = envValue('VAULT_UNWRAP_KEY_BASE64', 'VAULT_UNWRAP_KEY_HEX', 'VAULT_UNWRAP_KEY');
  if (direct) {
    return {
      source: process.env.VAULT_UNWRAP_KEY_BASE64 ? 'VAULT_UNWRAP_KEY_BASE64'
        : process.env.VAULT_UNWRAP_KEY_HEX ? 'VAULT_UNWRAP_KEY_HEX'
          : 'VAULT_UNWRAP_KEY',
      bytes: decodeRootFromText(direct, 'vault unwrap root'),
      deploymentReady: true,
    };
  }

  const file = envValue('VAULT_UNWRAP_KEY_FILE');
  if (file) {
    const text = await readFile(file, 'utf8');
    return {
      source: 'VAULT_UNWRAP_KEY_FILE',
      bytes: decodeRootFromText(text, 'VAULT_UNWRAP_KEY_FILE'),
      deploymentReady: true,
    };
  }

  return {
    source: 'ephemeral-preflight-root',
    bytes: randomBytes(32),
    deploymentReady: false,
  };
}

function getVersionName(key, parts) {
  const configured = envValue('CUSTOMER_GCP_KMS_KEY_VERSION', 'GCP_KMS_KEY_VERSION') || parts.keyVersion;
  if (configured) return configured;
  const primary = key?.primary?.name;
  if (typeof primary === 'string') return primary.split('/').pop() || '';
  return '';
}

function policyHasDecrypter(policy, member) {
  if (!member || !Array.isArray(policy?.bindings)) return false;
  return policy.bindings.some((binding) => (
    binding?.role === 'roles/cloudkms.cryptoKeyDecrypter'
      && Array.isArray(binding.members)
      && binding.members.includes(member)
  ));
}

async function encryptDecryptRoundTrip(parts, unwrapRoot) {
  const dir = await mkdtemp(join(tmpdir(), 'vaultproof-customer-kms-'));
  const plaintext = join(dir, 'unwrap-root.bin');
  const ciphertext = join(dir, 'unwrap-root.bin.gcp-kms');
  const decrypted = join(dir, 'unwrap-root.bin.dec');
  try {
    await writeFile(plaintext, unwrapRoot.bytes);
    const baseArgs = [
      '--project', parts.projectId,
      '--location', parts.location,
      '--keyring', parts.keyRing,
      '--key', parts.keyName,
    ];
    runGcloud(['kms', 'encrypt', ...baseArgs, '--plaintext-file', plaintext, '--ciphertext-file', ciphertext]);
    runGcloud(['kms', 'decrypt', ...baseArgs, '--ciphertext-file', ciphertext, '--plaintext-file', decrypted]);
    const decryptedBytes = await readFile(decrypted);
    if (!decryptedBytes.equals(unwrapRoot.bytes)) {
      throw new Error('GCP KMS decrypt did not return the original unwrap root.');
    }
    const ciphertextBase64 = unwrapRoot.deploymentReady
      ? (await readFile(ciphertext)).toString('base64')
      : '';
    return { ciphertextBase64 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function printEnv(result) {
  if (result.status !== 'ok') {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  if (!result.deployment_env?.GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64) {
    console.error('OUTPUT_FORMAT=env requires VAULT_UNWRAP_KEY_BASE64, VAULT_UNWRAP_KEY_HEX, or VAULT_UNWRAP_KEY_FILE.');
    process.exit(1);
  }
  for (const [key, value] of Object.entries(result.deployment_env)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

async function runSelfTest() {
  const parsed = parseKmsResource('projects/customer-prod/locations/us/keyRings/security/cryptoKeys/vaultproof-unwrap/cryptoKeyVersions/3');
  if (parsed.projectId !== 'customer-prod' || parsed.location !== 'us' || parsed.keyVersion !== '3') {
    throw new Error('KMS resource parser self-test failed.');
  }
  const member = normalizeRuntimeMember('vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com');
  if (member !== 'serviceAccount:vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com') {
    throw new Error('Runtime member parser self-test failed.');
  }
  const policy = {
    bindings: [{
      role: 'roles/cloudkms.cryptoKeyDecrypter',
      members: [member],
    }],
  };
  if (!policyHasDecrypter(policy, member)) {
    throw new Error('IAM policy parser self-test failed.');
  }
  console.log(JSON.stringify({ status: 'ok', self_test: true }, null, 2));
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsageAndExit();
  }
  if (boolEnv('SELF_TEST')) {
    await runSelfTest();
    return;
  }

  const resource = envValue('CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE', 'GCP_KMS_CRYPTO_KEY_RESOURCE');
  if (!resource) {
    throw new Error('CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE or GCP_KMS_CRYPTO_KEY_RESOURCE is required.');
  }
  const parts = parseKmsResource(resource);
  const expectedRuntimeMember = normalizeRuntimeMember(
    envValue('CUSTOMER_GCP_RUNTIME_SERVICE_ACCOUNT_EMAIL', 'GCP_SERVICE_ACCOUNT_EMAIL', 'EXECUTOR_SA')
      || 'vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com',
  );
  const requireRuntimeIam = boolEnv('REQUIRE_RUNTIME_KMS_IAM');
  const warnings = [];
  const blockers = [];

  const key = runGcloudJson([
    'kms', 'keys', 'describe', parts.keyName,
    '--project', parts.projectId,
    '--location', parts.location,
    '--keyring', parts.keyRing,
  ]);
  const keyVersion = getVersionName(key, parts);
  if (!keyVersion) {
    blockers.push('Could not determine the KMS primary key version. Set CUSTOMER_GCP_KMS_KEY_VERSION.');
  }

  const version = keyVersion
    ? runGcloudJson([
        'kms', 'keys', 'versions', 'describe', keyVersion,
        '--project', parts.projectId,
        '--location', parts.location,
        '--keyring', parts.keyRing,
        '--key', parts.keyName,
      ])
    : null;

  let iamBindingFound = null;
  try {
    const policy = runGcloudJson([
      'kms', 'keys', 'get-iam-policy', parts.keyName,
      '--project', parts.projectId,
      '--location', parts.location,
      '--keyring', parts.keyRing,
    ]);
    iamBindingFound = policyHasDecrypter(policy, expectedRuntimeMember);
    if (!iamBindingFound) {
      const detail = `${expectedRuntimeMember} is not bound to roles/cloudkms.cryptoKeyDecrypter on the key policy. It may still inherit access from a project/folder binding.`;
      if (requireRuntimeIam) blockers.push(detail);
      else warnings.push(detail);
    }
  } catch (error) {
    const detail = `Could not inspect KMS IAM policy: ${error instanceof Error ? error.message : String(error)}`;
    if (requireRuntimeIam) blockers.push(detail);
    else warnings.push(detail);
  }

  const unwrapRoot = await readVaultUnwrapRoot();
  const roundTrip = await encryptDecryptRoundTrip(parts, unwrapRoot);

  const protectionLevel = version?.protectionLevel || key?.versionTemplate?.protectionLevel || '';
  const state = version?.state || '';
  if (state && state !== 'ENABLED') {
    blockers.push(`KMS key version ${keyVersion} is ${state}, expected ENABLED.`);
  }
  if (!['SOFTWARE', 'HSM', 'EXTERNAL', 'EXTERNAL_VPC'].includes(protectionLevel)) {
    warnings.push(`KMS protection level is ${protectionLevel || 'unknown'}.`);
  }

  const deploymentEnv = {
    ENTERPRISE_CLOUD_PROVIDER: 'gcp',
    VAULTPROOF_EXECUTOR_MODE: 'confidential',
    GCP_KMS_CRYPTO_KEY_RESOURCE: parts.cryptoKeyResource,
    GCP_KMS_KEY_VERSION: keyVersion,
    GCP_KMS_PROTECTION_LEVEL: protectionLevel || 'UNKNOWN',
  };
  if (roundTrip.ciphertextBase64) {
    deploymentEnv.GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64 = roundTrip.ciphertextBase64;
  }

  const result = {
    status: blockers.length ? 'blocked' : 'ok',
    mode: 'gcp-customer-managed-kms-v1',
    customer_kms: {
      crypto_key_resource: parts.cryptoKeyResource,
      project_id: parts.projectId,
      location: parts.location,
      key_ring: parts.keyRing,
      key_name: parts.keyName,
      key_version: keyVersion || null,
      purpose: key?.purpose || null,
      protection_level: protectionLevel || null,
      algorithm: version?.algorithm || null,
      state: state || null,
    },
    runtime_access: {
      expected_decrypter_member: expectedRuntimeMember,
      key_iam_binding_found: iamBindingFound,
      require_key_iam_binding: requireRuntimeIam,
    },
    preflight: {
      encrypt_decrypt_round_trip: true,
      vault_unwrap_root_source: unwrapRoot.source,
      deployment_ciphertext_emitted: Boolean(roundTrip.ciphertextBase64),
    },
    deployment_env: deploymentEnv,
    warnings,
    blockers,
  };

  if ((process.env.OUTPUT_FORMAT || 'json') === 'env') {
    printEnv(result);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
  if (blockers.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
