#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const runLiveEdge = process.env.RUN_LIVE_EDGE === 'true';
const runLiveAppQa = process.env.RUN_LIVE_APP_QA === 'true';
const runLoginQa = process.env.RUN_LOGIN_QA === 'true';
const strictLive = process.env.STRICT_LIVE === 'true';
const enterpriseUrl = process.env.ENTERPRISE_URL || 'https://enterprise.vaultproof.dev';

const requiredFiles = [
  'docs/enterprise/gcp-full-buildout-plan.md',
  'docs/enterprise/gcp-build-status.md',
  'docs/enterprise/gcp-feature-inventory.md',
  'infra/gcp/enterprise-secure-runtime/configure-public-edge.sh',
  'infra/gcp/enterprise-secure-runtime/verify-public-edge.sh',
  'infra/gcp/enterprise-secure-runtime/publish-runtime-secrets.sh',
  'infra/gcp/enterprise-secure-runtime/collect-runtime-evidence.sh',
  'infra/gcp/enterprise-secure-runtime/prepare-first-goal-runtime.sh',
  'scripts/enterprise-login-readiness.mjs',
];

const steps = [];
const blockers = [];
const warnings = [];

function tail(value, max = 3000) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `...${text.slice(text.length - max)}`;
}

function runStep(name, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const step = {
    name,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'pass' : 'fail',
    durationMs,
  };
  if (result.status !== 0) {
    step.outputTail = tail(output);
    blockers.push({ name, detail: tail(output) || `exit ${result.status}` });
  }
  steps.push(step);
  return result;
}

function skipStep(name, command, reason) {
  steps.push({
    name,
    command,
    status: 'skipped',
    durationMs: 0,
    reason,
  });
  warnings.push({ name, detail: reason });
}

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    blockers.push({ name: 'required GCP launch file missing', detail: file });
  }
}

const fullBuildoutPlan = existsSync('docs/enterprise/gcp-full-buildout-plan.md')
  ? readFileSync('docs/enterprise/gcp-full-buildout-plan.md', 'utf8')
  : '';
if (!fullBuildoutPlan.includes('No HSM is included')) {
  blockers.push({
    name: 'GCP buildout plan must explicitly exclude HSM',
    detail: 'docs/enterprise/gcp-full-buildout-plan.md should keep the no-HSM launch rule visible.',
  });
}

runStep('GCP edge script syntax', 'bash', ['-n', 'infra/gcp/enterprise-secure-runtime/configure-public-edge.sh']);
runStep('GCP edge verifier syntax', 'bash', ['-n', 'infra/gcp/enterprise-secure-runtime/verify-public-edge.sh']);
runStep('GCP secret publisher syntax', 'bash', ['-n', 'infra/gcp/enterprise-secure-runtime/publish-runtime-secrets.sh']);
runStep('GCP runtime evidence collector syntax', 'bash', ['-n', 'infra/gcp/enterprise-secure-runtime/collect-runtime-evidence.sh']);
runStep('GCP first-goal runtime preparer syntax', 'bash', ['-n', 'infra/gcp/enterprise-secure-runtime/prepare-first-goal-runtime.sh']);
runStep('GCP build doc generator syntax', 'node', ['--check', 'scripts/update-gcp-build-doc.mjs']);
runStep('Enterprise login readiness syntax', 'node', ['--check', 'scripts/enterprise-login-readiness.mjs']);
runStep('Enterprise build', 'npm', ['run', 'build:enterprise']);
runStep('Enterprise smoke', 'npm', ['run', 'test:enterprise-smoke']);

if (runLiveEdge) {
  runStep('GCP live edge verification', 'npm', ['run', 'verify:gcp-enterprise-edge']);
} else {
  skipStep('GCP live edge verification', 'npm run verify:gcp-enterprise-edge', 'Set RUN_LIVE_EDGE=true after gcloud auth and edge resources are ready.');
}

if (runLiveAppQa) {
  runStep('GCP live app QA', 'npm', ['run', 'qa:enterprise-live-app'], {
    env: {
      ENTERPRISE_URL: enterpriseUrl,
      ENTERPRISE_EXPECTED_SECURITY_PROFILE: process.env.ENTERPRISE_EXPECTED_SECURITY_PROFILE || 'google-confidential-production',
    },
  });
} else {
  skipStep('GCP live app QA', 'npm run qa:enterprise-live-app', 'Set RUN_LIVE_APP_QA=true after DNS and readiness are production-ready.');
}

if (runLoginQa) {
  runStep('GCP login readiness QA', 'npm', ['run', 'qa:enterprise-login'], {
    env: {
      ENTERPRISE_URL: enterpriseUrl,
      LOGIN_QA_REQUIRE_SESSION: process.env.LOGIN_QA_REQUIRE_SESSION || (strictLive ? 'true' : 'false'),
      LOGIN_QA_OAUTH_PROVIDER: process.env.LOGIN_QA_OAUTH_PROVIDER || '',
    },
  });
} else {
  skipStep('GCP login readiness QA', 'npm run qa:enterprise-login', 'Set RUN_LOGIN_QA=true after Supabase service-role credentials are available.');
}

if (strictLive && (!runLiveEdge || !runLiveAppQa || !runLoginQa)) {
  blockers.push({
    name: 'strict live launch gate requires live checks',
    detail: 'Set RUN_LIVE_EDGE=true, RUN_LIVE_APP_QA=true, and RUN_LOGIN_QA=true with STRICT_LIVE=true.',
  });
}

const result = {
  status: blockers.length > 0 ? 'blocked' : 'ok',
  enterpriseUrl,
  options: {
    runLiveEdge,
    runLiveAppQa,
    runLoginQa,
    strictLive,
  },
  steps,
  warnings,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
