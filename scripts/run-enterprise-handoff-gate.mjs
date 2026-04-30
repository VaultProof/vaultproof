#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outputDir = process.env.OUTPUT_DIR || '/tmp/vaultproof-enterprise-handoff-gate';
const runLiveQa = process.env.RUN_LIVE_APP_QA === 'true';
const runControlPlaneSmoke = process.env.RUN_CONTROL_PLANE_SMOKE === 'true';
const runHardeningStatus = process.env.RUN_HARDENING_STATUS === 'true';
const requireEvidence = process.env.REQUIRE_EVIDENCE === 'true';
const requireValidEvidence = process.env.REQUIRE_VALID_EVIDENCE === 'true';

const requiredPackageFiles = [
  'docs/enterprise/features-and-access-guide.md',
  'docs/plans/2026-04-26-enterprise-most-secure-build.md',
  'docs/enterprise/vaultproof-managed-apim-policy.xml',
  'docs/enterprise/customer-managed-apim-policy.xml',
  'docs/enterprise/customer-managed-apim-device-policy.xml',
  'docs/enterprise/customer-managed-apim-mtls-policy.xml',
  'infra/azure/enterprise-secure-runtime/README.md',
];

const requiredPackageCommands = [
  'npm run verify:enterprise-production',
  'npm run evidence:enterprise-production',
  'npm run validate:enterprise-evidence',
  'npm run package:enterprise-handoff',
  'npm run test:enterprise-apim-policies',
  'npm run prepare:enterprise-mtls',
  'npm run cleanup:enterprise-container-apps',
];

const steps = [];
const blockers = [];
const warnings = [];

function runStep(name, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
  const durationMs = Date.now() - startedAt;
  const step = {
    name,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'pass' : 'fail',
    durationMs,
  };
  steps.push(step);
  if (result.status !== 0) {
    blockers.push({
      name,
      detail: result.stderr || result.stdout || `exit ${result.status}`,
    });
  }
  return result;
}

function parsePackageDir(stdout) {
  const lines = String(stdout || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = lines.slice(index).join('\n').trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const payload = JSON.parse(candidate);
      return payload.packageDir || '';
    } catch {
      // Keep scanning in case npm printed other structured output first.
    }
  }
  return '';
}

function verifyManifest(packageDir) {
  const manifestPath = join(packageDir, 'manifest.json');
  if (!packageDir || !existsSync(manifestPath)) {
    blockers.push({ name: 'handoff manifest missing', detail: manifestPath || 'unknown package directory' });
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = new Set((manifest.files || []).map((file) => file.path));
  const commands = new Set(manifest.operatorCommands || []);

  for (const file of requiredPackageFiles) {
    if (!files.has(file)) {
      blockers.push({ name: 'handoff manifest missing required file', detail: file });
    }
  }

  for (const command of requiredPackageCommands) {
    if (!commands.has(command)) {
      blockers.push({ name: 'handoff manifest missing required command', detail: command });
    }
  }

  if (manifest.blockers?.length) {
    blockers.push({ name: 'handoff package reported blockers', detail: manifest.blockers });
  }
  if (manifest.warnings?.length) {
    warnings.push(...manifest.warnings.map((warning) => ({
      name: `handoff package warning: ${warning.name}`,
      detail: warning.detail,
    })));
  }
  if (requireEvidence && !manifest.evidence) {
    blockers.push({ name: 'required evidence missing from handoff package', detail: packageDir });
  }
  if (requireValidEvidence && manifest.evidence?.validationOk !== true) {
    blockers.push({ name: 'required valid evidence missing from handoff package', detail: manifest.evidence || null });
  }

  steps.push({
    name: 'Handoff manifest verification',
    command: `read ${manifestPath}`,
    status: 'pass',
    durationMs: 0,
  });
}

runStep('APIM policy template smoke', 'npm', ['run', 'test:enterprise-apim-policies']);

const packageResult = runStep('Build handoff package', 'npm', ['run', 'package:enterprise-handoff'], {
  env: {
    OUTPUT_DIR: outputDir,
    REQUIRE_EVIDENCE: requireEvidence ? 'true' : 'false',
    REQUIRE_VALID_EVIDENCE: requireValidEvidence ? 'true' : 'false',
  },
});
verifyManifest(parsePackageDir(packageResult.stdout));

if (runLiveQa) {
  runStep('Live enterprise app QA', 'npm', ['run', 'qa:enterprise-live-app']);
}

if (runControlPlaneSmoke) {
  runStep('Enterprise control-plane smoke', 'npm', ['run', 'test:enterprise-control-plane-smoke']);
}

if (runHardeningStatus) {
  runStep('Enterprise hardening status', 'npm', ['run', 'status:enterprise-hardening'], {
    env: {
      EXIT_NONZERO_ON_ATTENTION: process.env.EXIT_NONZERO_ON_ATTENTION || 'false',
    },
  });
}

const result = {
  status: blockers.length > 0 ? 'blocked' : 'ok',
  outputDir,
  options: {
    runLiveQa,
    runControlPlaneSmoke,
    runHardeningStatus,
    requireEvidence,
    requireValidEvidence,
  },
  steps,
  warnings,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
