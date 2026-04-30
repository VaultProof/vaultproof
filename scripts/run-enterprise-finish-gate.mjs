#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outputDir = process.env.OUTPUT_DIR || '/tmp/vaultproof-enterprise-finish-gate';
const runLocalSmoke = process.env.RUN_LOCAL_SMOKE !== 'false';
const runApimPolicySmoke = process.env.RUN_APIM_POLICY_SMOKE !== 'false';
const runHandoffGate = process.env.RUN_HANDOFF_GATE !== 'false';
const runLiveQa = process.env.RUN_LIVE_APP_QA !== 'false';
const runHardeningStatus = process.env.RUN_HARDENING_STATUS !== 'false';
const requireEvidence = process.env.REQUIRE_EVIDENCE === 'true';
const requireValidEvidence = process.env.REQUIRE_VALID_EVIDENCE === 'true';
const strictCustomerHandoff = process.env.STRICT_CUSTOMER_HANDOFF === 'true';
const strictHardeningClear = process.env.STRICT_HARDENING_CLEAR === 'true';

const steps = [];
const blockers = [];
const pendingActions = [];
const warnings = [];

function bool(value) {
  return value ? 'true' : 'false';
}

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
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = `${stdout}\n${stderr}`;
  const hasAttention = options.attentionPattern?.test(output) || false;
  const status = result.status === 0 ? (hasAttention ? 'attention' : 'pass') : 'fail';

  const step = {
    name,
    command: [command, ...args].join(' '),
    status,
    durationMs,
  };
  if (status !== 'pass') {
    step.outputTail = tail(output);
  }
  steps.push(step);

  if (result.status !== 0) {
    blockers.push({
      name,
      detail: tail(stderr || stdout || `exit ${result.status}`),
    });
  } else if (hasAttention) {
    pendingActions.push({
      name,
      detail: options.attentionDetail || 'Step completed, but reported remaining attention items.',
    });
  }
  return result;
}

function runOrSkip(enabled, name, command, args, options = {}) {
  if (!enabled) {
    steps.push({
      name,
      command: [command, ...args].join(' '),
      status: 'skipped',
      durationMs: 0,
    });
    return null;
  }
  return runStep(name, command, args, options);
}

runOrSkip(
  runLocalSmoke,
  'Enterprise control-plane smoke',
  'npm',
  ['run', 'test:enterprise-control-plane-smoke'],
);

runOrSkip(
  runApimPolicySmoke,
  'APIM policy template smoke',
  'npm',
  ['run', 'test:enterprise-apim-policies'],
);

runOrSkip(
  runHandoffGate,
  'Enterprise handoff gate',
  'npm',
  ['run', 'gate:enterprise-handoff'],
  {
    env: {
      OUTPUT_DIR: `${outputDir}/handoff`,
      RUN_LIVE_APP_QA: 'false',
      RUN_CONTROL_PLANE_SMOKE: 'false',
      RUN_HARDENING_STATUS: 'false',
      REQUIRE_EVIDENCE: bool(requireEvidence),
      REQUIRE_VALID_EVIDENCE: bool(requireValidEvidence),
    },
  },
);

runOrSkip(
  runLiveQa,
  'Live enterprise app QA',
  'npm',
  ['run', 'qa:enterprise-live-app'],
);

runOrSkip(
  runHardeningStatus,
  'Enterprise hardening status',
  'npm',
  ['run', 'status:enterprise-hardening'],
  {
    env: {
      RUN_LIVE_APP_QA: 'false',
      EXIT_NONZERO_ON_ATTENTION: 'false',
    },
    attentionPattern: /need attention|BLOCKER | WARN | attention\s+/i,
    attentionDetail: 'Read-only hardening status still reports live cutover, cleanup, rotation, or access-hardening items.',
  },
);

if (strictCustomerHandoff && (!requireEvidence || !requireValidEvidence)) {
  blockers.push({
    name: 'strict customer handoff requires evidence gates',
    detail: 'Set REQUIRE_EVIDENCE=true and REQUIRE_VALID_EVIDENCE=true with STRICT_CUSTOMER_HANDOFF=true.',
  });
}

if (strictHardeningClear && pendingActions.length > 0) {
  blockers.push({
    name: 'strict hardening clear failed',
    detail: pendingActions,
  });
}

if (!runLiveQa) {
  warnings.push({
    name: 'live app QA skipped',
    detail: 'Set RUN_LIVE_APP_QA=true before external customer handoff.',
  });
}

if (!runHardeningStatus) {
  warnings.push({
    name: 'hardening status skipped',
    detail: 'Set RUN_HARDENING_STATUS=true before final Azure cutover decisions.',
  });
}

const status = blockers.length > 0 ? 'blocked' : pendingActions.length > 0 ? 'attention' : 'ok';

console.log(JSON.stringify({
  status,
  outputDir,
  options: {
    runLocalSmoke,
    runApimPolicySmoke,
    runHandoffGate,
    runLiveQa,
    runHardeningStatus,
    requireEvidence,
    requireValidEvidence,
    strictCustomerHandoff,
    strictHardeningClear,
  },
  steps,
  pendingActions,
  warnings,
  blockers,
}, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
