#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const outputRoot = process.env.OUTPUT_DIR || '/tmp/vaultproof-enterprise-handoff';
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/vaultproof-production-evidence';
const requireEvidence = process.env.REQUIRE_EVIDENCE === 'true';
const requireValidEvidence = process.env.REQUIRE_VALID_EVIDENCE === 'true';
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const packageName = process.env.PACKAGE_NAME || `vaultproof-enterprise-handoff-${timestamp}`;
const packageDir = join(outputRoot, packageName);

const requiredFiles = [
  'docs/enterprise/features-and-access-guide.md',
  'docs/plans/2026-04-26-enterprise-most-secure-build.md',
  'docs/enterprise/vaultproof-managed-apim-policy.xml',
  'docs/enterprise/customer-managed-apim-policy.xml',
  'docs/enterprise/customer-managed-apim-device-policy.xml',
  'docs/enterprise/customer-managed-apim-mtls-policy.xml',
  'infra/azure/enterprise-secure-runtime/README.md',
];

const operatorCommands = [
  'npm run verify:enterprise-production',
  'npm run evidence:enterprise-production',
  'npm run validate:enterprise-evidence',
  'npm run status:enterprise-hardening',
  'npm run test:enterprise-apim-policies',
  'npm run prepare:enterprise-secret-rotation',
  'npm run prepare:enterprise-private-origin',
  'npm run prepare:enterprise-apim-jwt',
  'npm run prepare:enterprise-mtls',
  'npm run prepare:enterprise-origin-cert',
  'npm run prepare:enterprise-origin-tls',
  'npm run verify:enterprise-origin-tls',
  'npm run prepare:enterprise-alternate-access',
  'npm run verify:enterprise-alternate-access',
  'npm run harden:enterprise-ssh',
  'npm run cleanup:enterprise-container-apps',
];

const warnings = [];
const blockers = [];
const copiedFiles = [];

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyRequiredFile(relativePath) {
  const source = join(root, relativePath);
  const target = join(packageDir, relativePath);
  if (!existsSync(source)) {
    blockers.push({ name: 'missing required handoff file', detail: relativePath });
    return;
  }
  ensureDir(dirname(target));
  copyFileSync(source, target);
  copiedFiles.push(relativePath);
}

function latestEvidenceFile() {
  if (!existsSync(evidenceDir)) return '';
  const files = readdirSync(evidenceDir)
    .filter((file) => /^vaultproof-enterprise-production-evidence-.*\.json$/.test(file))
    .sort();
  return files.length > 0 ? join(evidenceDir, files.at(-1)) : '';
}

function validateEvidence(evidencePath) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/validate-enterprise-production-evidence.mjs'), evidencePath],
    { cwd: root, encoding: 'utf8' },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    parsed = null;
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: parsed || result.stdout,
    stderr: result.stderr,
  };
}

function collectSecretFindings(value, path = '$', findings = []) {
  if (typeof value === 'string') {
    const checks = [
      [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'private key material'],
      [/\bsk-(?:live|test|proj|ant|[A-Za-z0-9])[A-Za-z0-9_-]{16,}\b/, 'provider API key shaped string'],
      [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, 'JWT shaped string'],
    ];
    for (const [pattern, label] of checks) {
      if (pattern.test(value)) findings.push({ path, label });
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretFindings(item, `${path}[${index}]`, findings));
    return findings;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectSecretFindings(item, `${path}.${key}`, findings);
    }
  }
  return findings;
}

function writePackageReadme(manifestPath) {
  const content = `# VaultProof Enterprise Handoff Package

Generated at: ${new Date().toISOString()}

This package collects the customer-facing enterprise guide, the source-of-truth build plan, APIM policy templates, secure-runtime runbook, and latest production evidence if one was available locally.

## Start Here

1. Read \`docs/enterprise/features-and-access-guide.md\`.
2. Review \`docs/plans/2026-04-26-enterprise-most-secure-build.md\` for current status and pending live actions.
3. Review APIM templates under \`docs/enterprise/*.xml\`.
4. If present, review \`evidence/latest-production-evidence.json\` and \`evidence/validation-result.json\`.
5. Use \`manifest.json\` for the machine-readable file list, warnings, and blockers.

## Operator Commands

${operatorCommands.map((command) => `- \`${command}\``).join('\n')}

## Manifest

Machine-readable manifest: \`${manifestPath}\`
`;
  writeFileSync(join(packageDir, 'README.md'), content);
}

ensureDir(packageDir);
for (const file of requiredFiles) {
  copyRequiredFile(file);
}

let evidence = null;
const evidencePath = latestEvidenceFile();
if (evidencePath) {
  const evidenceTarget = join(packageDir, 'evidence/latest-production-evidence.json');
  ensureDir(dirname(evidenceTarget));
  copyFileSync(evidencePath, evidenceTarget);
  copiedFiles.push('evidence/latest-production-evidence.json');

  const validation = validateEvidence(evidencePath);
  writeFileSync(join(packageDir, 'evidence/validation-result.json'), JSON.stringify(validation, null, 2) + '\n');
  copiedFiles.push('evidence/validation-result.json');
  evidence = {
    source: evidencePath,
    copiedTo: 'evidence/latest-production-evidence.json',
    validationOk: validation.ok,
  };
  if (!validation.ok) {
    const item = { name: 'production evidence validation failed', detail: evidencePath };
    if (requireValidEvidence) blockers.push(item);
    else warnings.push(item);
  }
} else {
  const item = { name: 'no local production evidence bundle found', detail: evidenceDir };
  if (requireEvidence) blockers.push(item);
  else warnings.push(item);
}

const packageSnapshot = copiedFiles.map((relativePath) => ({
  path: relativePath,
  bytes: readFileSync(join(packageDir, relativePath)).length,
}));

const secretFindings = [];
for (const file of copiedFiles) {
  const content = readFileSync(join(packageDir, file), 'utf8');
  collectSecretFindings(content, file, secretFindings);
}
if (secretFindings.length > 0) {
  blockers.push({
    name: 'handoff package contains obvious secret-shaped material',
    detail: secretFindings.slice(0, 10),
  });
}

const manifest = {
  schemaVersion: 'vaultproof.enterprise.handoffPackage.v1',
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/build-enterprise-handoff-package.mjs',
  gitCommit: gitCommit(),
  packageDir,
  enterpriseUrl: process.env.ENTERPRISE_URL || 'https://enterprise.vaultproof.dev',
  evidence,
  files: packageSnapshot,
  operatorCommands,
  warnings,
  blockers,
};

writeFileSync(join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writePackageReadme('manifest.json');

console.log(JSON.stringify({
  status: blockers.length > 0 ? 'blocked' : 'ok',
  packageDir,
  files: copiedFiles.length + 2,
  warnings: warnings.length,
  blockers,
}, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
