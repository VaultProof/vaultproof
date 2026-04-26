#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function usage() {
  console.error(`Usage:
  node build-skr-policy.mjs --token-file attestation.jwt --out-dir ./skr-artifacts

Options:
  --token-file <path>   File containing the MAA attestation JWT from AttestationClient.
  --out-dir <path>      Directory for skr-policy.json, skr-policy.b64, and skr-env.sh.
  --mode <mode>         base or strict-vm. Default: strict-vm.

The strict-vm mode pins the policy to this VM's SEV-SNP launch measurement and VM unique ID.
Use one policy per production executor VM, or add multiple policy entries for HA.`);
}

function parseArgs(argv) {
  const args = { mode: 'strict-vm' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--token-file' && next) {
      args.tokenFile = next;
      i += 1;
    } else if (arg === '--out-dir' && next) {
      args.outDir = next;
      i += 1;
    } else if (arg === '--mode' && next) {
      args.mode = next;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!args.tokenFile || !args.outDir) {
    usage();
    process.exit(2);
  }
  if (!['base', 'strict-vm'].includes(args.mode)) {
    throw new Error('--mode must be base or strict-vm');
  }
  return args;
}

function decodeJwtPayload(jwt) {
  const parts = jwt.trim().split('.');
  if (parts.length < 2 || !parts[1]) {
    throw new Error('Attestation token is not a compact JWT.');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function claim(payload, path) {
  return path.split('.').reduce((value, key) => {
    if (value && typeof value === 'object' && key in value) return value[key];
    return undefined;
  }, payload);
}

function requireClaim(payload, path) {
  const value = claim(payload, path);
  if (value === undefined || value === null || value === '') {
    throw new Error(`Attestation token is missing required claim: ${path}`);
  }
  return value;
}

function equals(path, value) {
  return { claim: path, equals: value };
}

function optionalEquals(payload, path) {
  const value = claim(payload, path);
  return value === undefined || value === null ? null : equals(path, value);
}

function buildPolicy(payload, mode) {
  const issuer = requireClaim(payload, 'iss');
  requireClaim(payload, 'x-ms-isolation-tee.x-ms-attestation-type');
  requireClaim(payload, 'x-ms-isolation-tee.x-ms-compliance-status');

  const allOf = [
    equals('x-ms-isolation-tee.x-ms-attestation-type', 'sevsnpvm'),
    equals('x-ms-isolation-tee.x-ms-compliance-status', 'azure-compliant-cvm'),
    equals('secureboot', true),
    equals('x-ms-azurevm-debuggersdisabled', true),
    equals('x-ms-azurevm-signingdisabled', true),
    equals('x-ms-azurevm-kerneldebug-enabled', false),
    equals('x-ms-azurevm-hypervisordebug-enabled', false),
    equals('x-ms-isolation-tee.x-ms-sevsnpvm-is-debuggable', false),
    equals('x-ms-isolation-tee.x-ms-sevsnpvm-migration-allowed', false),
    equals('x-ms-isolation-tee.x-ms-runtime.vm-configuration.secure-boot', true),
    equals('x-ms-isolation-tee.x-ms-runtime.vm-configuration.tpm-enabled', true),
  ];

  if (mode === 'strict-vm') {
    [
      'x-ms-azurevm-vmid',
      'x-ms-isolation-tee.x-ms-runtime.vm-configuration.vmUniqueId',
      'x-ms-isolation-tee.x-ms-sevsnpvm-launchmeasurement',
      'x-ms-isolation-tee.x-ms-sevsnpvm-familyId',
      'x-ms-isolation-tee.x-ms-sevsnpvm-imageId',
      'x-ms-isolation-tee.x-ms-sevsnpvm-guestsvn',
      'x-ms-isolation-tee.x-ms-sevsnpvm-bootloader-svn',
      'x-ms-isolation-tee.x-ms-sevsnpvm-tee-svn',
      'x-ms-isolation-tee.x-ms-sevsnpvm-snpfw-svn',
      'x-ms-isolation-tee.x-ms-sevsnpvm-microcode-svn',
    ].map((path) => optionalEquals(payload, path))
      .filter(Boolean)
      .forEach((condition) => allOf.push(condition));
  }

  return {
    version: '1.0.0',
    anyOf: [
      {
        authority: issuer,
        allOf,
      },
    ],
  };
}

function hashBase64Url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function measurementSummary(payload) {
  const launch = claim(payload, 'x-ms-isolation-tee.x-ms-sevsnpvm-launchmeasurement');
  const vm = claim(payload, 'x-ms-isolation-tee.x-ms-runtime.vm-configuration.vmUniqueId') || claim(payload, 'x-ms-azurevm-vmid');
  const secureBoot = claim(payload, 'secureboot');
  const tpm = claim(payload, 'x-ms-isolation-tee.x-ms-runtime.vm-configuration.tpm-enabled');
  return [
    'sevsnpvm',
    launch ? `launch:${launch}` : null,
    vm ? `vm:${vm}` : null,
    secureBoot !== undefined ? `secureboot:${secureBoot}` : null,
    tpm !== undefined ? `tpm:${tpm}` : null,
  ].filter(Boolean).join(';');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const args = parseArgs(process.argv);
const token = readFileSync(resolve(args.tokenFile), 'utf8').trim();
const payload = decodeJwtPayload(token);
const policy = buildPolicy(payload, args.mode);
const policyJson = `${JSON.stringify(policy, null, 2)}\n`;
const policyB64 = Buffer.from(policyJson, 'utf8').toString('base64');
const tokenHash = hashBase64Url(token);
const policyHash = `sha256:${hashBase64Url(policyJson)}`;
const summary = measurementSummary(payload);
const outDir = resolve(args.outDir);

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'skr-policy.json'), policyJson, { mode: 0o600 });
writeFileSync(resolve(outDir, 'skr-policy.b64'), `${policyB64}\n`, { mode: 0o600 });
writeFileSync(resolve(outDir, 'skr-env.sh'), [
  `export AZURE_ATTESTATION_TOKEN_HASH=${shellQuote(tokenHash)}`,
  `export AZURE_KEY_RELEASE_POLICY_HASH=${shellQuote(policyHash)}`,
  `export AZURE_MEASUREMENT_SUMMARY=${shellQuote(summary)}`,
  '',
].join('\n'), { mode: 0o600 });

console.log(JSON.stringify({
  policyFile: resolve(outDir, 'skr-policy.json'),
  policyBase64File: resolve(outDir, 'skr-policy.b64'),
  envFile: resolve(outDir, 'skr-env.sh'),
  attestationIssuer: payload.iss,
  attestationTokenHash: tokenHash,
  keyReleasePolicyHash: policyHash,
  measurementSummary: summary,
  mode: args.mode,
}, null, 2));
