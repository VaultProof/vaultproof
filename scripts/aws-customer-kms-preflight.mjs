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
  console.log(`VaultProof AWS customer-managed KMS preflight

Required:
  CUSTOMER_AWS_KMS_KEY_ID or AWS_KMS_KEY_ID or AWS_KMS_KEY_ARN
  AWS_REGION or AWS_DEFAULT_REGION, unless the key id is an ARN with a region

Optional:
  VAULT_UNWRAP_KEY_BASE64 or VAULT_UNWRAP_KEY_HEX
  VAULT_UNWRAP_KEY_FILE
  CUSTOMER_AWS_RUNTIME_ROLE_ARN or AWS_ROLE_ARN
  REQUIRE_RUNTIME_KMS_IAM=true
  OUTPUT_FORMAT=json|env

Examples:
  CUSTOMER_AWS_KMS_KEY_ID="arn:aws:kms:us-east-1:111122223333:key/..." \\
  npm run preflight:aws-customer-kms

  CUSTOMER_AWS_KMS_KEY_ID="arn:aws:kms:us-east-1:111122223333:key/..." \\
  VAULT_UNWRAP_KEY_BASE64="..." \\
  OUTPUT_FORMAT=env \\
  npm run preflight:aws-customer-kms
`);
  process.exit(0);
}

function parseAwsArn(value) {
  if (!String(value || '').startsWith('arn:')) return {};
  const parts = String(value).split(':');
  return {
    region: parts[3] || '',
    accountId: parts[4] || '',
  };
}

function resolveRegion(keyId) {
  return envValue('CUSTOMER_AWS_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION') || parseAwsArn(keyId).region;
}

function runAws(args) {
  const result = spawnSync('aws', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(output || `aws ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout || '';
}

function runAwsJson(args) {
  const output = runAws([...args, '--output', 'json']);
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

async function encryptDecryptRoundTrip(input) {
  const dir = await mkdtemp(join(tmpdir(), 'vaultproof-aws-customer-kms-'));
  const plaintext = join(dir, 'unwrap-root.bin');
  const ciphertext = join(dir, 'unwrap-root.bin.aws-kms');
  try {
    await writeFile(plaintext, input.unwrapRoot.bytes);
    const encrypted = runAwsJson([
      'kms', 'encrypt',
      '--region', input.region,
      '--key-id', input.keyId,
      '--plaintext', `fileb://${plaintext}`,
    ]);
    if (!encrypted.CiphertextBlob) {
      throw new Error('AWS KMS encrypt response did not include CiphertextBlob.');
    }
    await writeFile(ciphertext, Buffer.from(encrypted.CiphertextBlob, 'base64'));
    const decrypted = runAwsJson([
      'kms', 'decrypt',
      '--region', input.region,
      '--ciphertext-blob', `fileb://${ciphertext}`,
      '--key-id', input.keyId,
    ]);
    const decryptedBytes = Buffer.from(decrypted.Plaintext || '', 'base64');
    if (!decryptedBytes.equals(input.unwrapRoot.bytes)) {
      throw new Error('AWS KMS decrypt did not return the original unwrap root.');
    }
    return {
      ciphertextBase64: input.unwrapRoot.deploymentReady ? encrypted.CiphertextBlob : '',
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function simulateRuntimeDecrypt(input) {
  if (!input.roleArn) return { checked: false, allowed: null, warning: 'No AWS runtime role ARN was provided for IAM simulation.' };
  try {
    const result = runAwsJson([
      'iam', 'simulate-principal-policy',
      '--policy-source-arn', input.roleArn,
      '--action-names', 'kms:Decrypt',
      '--resource-arns', input.keyArn || input.keyId,
    ]);
    const decision = result.EvaluationResults?.[0]?.EvalDecision || '';
    return {
      checked: true,
      allowed: decision.toLowerCase() === 'allowed',
      decision,
    };
  } catch (error) {
    return {
      checked: false,
      allowed: null,
      warning: `Could not simulate runtime role KMS decrypt access: ${error instanceof Error ? error.message : String(error)}`,
    };
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
  if (!result.deployment_env?.AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64) {
    console.error('OUTPUT_FORMAT=env requires VAULT_UNWRAP_KEY_BASE64, VAULT_UNWRAP_KEY_HEX, or VAULT_UNWRAP_KEY_FILE.');
    process.exit(1);
  }
  for (const [key, value] of Object.entries(result.deployment_env)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

async function runSelfTest() {
  const arn = parseAwsArn('arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab');
  if (arn.region !== 'us-east-1' || arn.accountId !== '111122223333') {
    throw new Error('AWS ARN parser self-test failed.');
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

  const keyId = envValue('CUSTOMER_AWS_KMS_KEY_ID', 'AWS_KMS_KEY_ARN', 'AWS_KMS_KEY_ID');
  if (!keyId) {
    throw new Error('CUSTOMER_AWS_KMS_KEY_ID, AWS_KMS_KEY_ARN, or AWS_KMS_KEY_ID is required.');
  }
  const region = resolveRegion(keyId);
  if (!region) {
    throw new Error('AWS_REGION or AWS_DEFAULT_REGION is required unless the KMS key ID is an ARN with a region.');
  }
  const roleArn = envValue('CUSTOMER_AWS_RUNTIME_ROLE_ARN', 'AWS_ROLE_ARN');
  const requireRuntimeIam = boolEnv('REQUIRE_RUNTIME_KMS_IAM');
  const warnings = [];
  const blockers = [];

  const described = runAwsJson([
    'kms', 'describe-key',
    '--region', region,
    '--key-id', keyId,
  ]);
  const metadata = described.KeyMetadata || {};
  const keyArn = metadata.Arn || (String(keyId).startsWith('arn:') ? keyId : '');
  const keyState = metadata.KeyState || '';
  if (keyState && keyState !== 'Enabled') {
    blockers.push(`AWS KMS key state is ${keyState}, expected Enabled.`);
  }
  if (metadata.KeyUsage && metadata.KeyUsage !== 'ENCRYPT_DECRYPT') {
    blockers.push(`AWS KMS key usage is ${metadata.KeyUsage}, expected ENCRYPT_DECRYPT.`);
  }
  if (metadata.KeySpec && metadata.KeySpec !== 'SYMMETRIC_DEFAULT') {
    warnings.push(`AWS KMS key spec is ${metadata.KeySpec}; VaultProof v1 expects symmetric KMS ciphertext for the unwrap root.`);
  }

  const unwrapRoot = await readVaultUnwrapRoot();
  const roundTrip = await encryptDecryptRoundTrip({ region, keyId, unwrapRoot });
  const iamSimulation = simulateRuntimeDecrypt({ roleArn, keyArn, keyId });
  if (iamSimulation.warning) warnings.push(iamSimulation.warning);
  if (requireRuntimeIam && iamSimulation.allowed !== true) {
    blockers.push(`AWS runtime role ${roleArn || '(missing)'} is not proven allowed for kms:Decrypt.`);
  }

  const deploymentEnv = {
    ENTERPRISE_CLOUD_PROVIDER: 'aws',
    VAULTPROOF_EXECUTOR_MODE: 'confidential',
    AWS_REGION: region,
    AWS_KMS_KEY_ID: keyId,
    AWS_KMS_KEY_ARN: keyArn,
    AWS_KMS_KEY_SPEC: metadata.KeySpec || '',
    AWS_KMS_KEY_USAGE: metadata.KeyUsage || '',
    AWS_KMS_KEY_STATE: metadata.KeyState || '',
    AWS_KMS_KEY_ORIGIN: metadata.Origin || '',
  };
  if (roundTrip.ciphertextBase64) {
    deploymentEnv.AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64 = roundTrip.ciphertextBase64;
  }

  const result = {
    status: blockers.length ? 'blocked' : 'ok',
    mode: 'aws-customer-managed-kms-v1',
    customer_kms: {
      key_id: metadata.KeyId || keyId,
      key_arn: keyArn || null,
      account_id: metadata.AWSAccountId || parseAwsArn(keyArn).accountId || null,
      region,
      key_state: metadata.KeyState || null,
      key_spec: metadata.KeySpec || null,
      key_usage: metadata.KeyUsage || null,
      key_origin: metadata.Origin || null,
      multi_region: metadata.MultiRegion ?? null,
    },
    runtime_access: {
      runtime_role_arn: roleArn || null,
      simulation_checked: iamSimulation.checked,
      simulation_allowed: iamSimulation.allowed,
      simulation_decision: iamSimulation.decision || null,
      require_simulation_allowed: requireRuntimeIam,
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
