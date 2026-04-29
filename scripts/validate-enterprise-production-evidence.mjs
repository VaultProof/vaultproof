#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_EVIDENCE_DIR = '/tmp/vaultproof-production-evidence';
const evidencePath = process.argv[2] || latestEvidenceFile(DEFAULT_EVIDENCE_DIR);

if (!evidencePath) {
  fail(`No evidence file supplied and no evidence files found in ${DEFAULT_EVIDENCE_DIR}`);
}

const evidence = readJson(evidencePath);
const failures = [];
const warnings = [];

function latestEvidenceFile(dir) {
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir)
    .filter((file) => /^vaultproof-enterprise-production-evidence-.*\.json$/.test(file))
    .map((file) => join(dir, file))
    .sort();
  return files.at(-1) || '';
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Could not read evidence JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function get(path, fallback = undefined) {
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, evidence) ?? fallback;
}

function check(name, condition, detail) {
  if (!condition) failures.push({ name, detail: detail || 'check failed' });
}

function warn(name, condition, detail) {
  if (!condition) warnings.push({ name, detail: detail || 'check warning' });
}

function statusCode(path) {
  return String(get(path, ''));
}

function isEnabledOrigin(origin) {
  return String(origin?.enabledState || '').toLowerCase() === 'enabled';
}

function originHost(origin) {
  return String(origin?.hostName || origin?.originHostHeader || '').toLowerCase();
}

function hasBroadSource(rule) {
  const prefixes = [
    rule?.sourceAddressPrefix,
    ...(Array.isArray(rule?.sourceAddressPrefixes) ? rule.sourceAddressPrefixes : []),
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  return prefixes.some((value) => value === '*' || value === 'internet' || value === '0.0.0.0/0' || value === '::/0');
}

function hasPort(rule, port) {
  const ports = [
    rule?.destinationPortRange,
    ...(Array.isArray(rule?.destinationPortRanges) ? rule.destinationPortRanges : []),
  ].filter(Boolean).map(String);
  return ports.includes(port) || ports.includes('*');
}

function collectSecretFindings(value, path = '$', findings = []) {
  if (typeof value === 'string') {
    const checks = [
      [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'private key material'],
      [/\bsk-(?:live|test|proj|ant|[A-Za-z0-9])[A-Za-z0-9_-]{16,}\b/, 'provider API key shaped string'],
      [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, 'JWT shaped string'],
      [/\b(?:SUPABASE_SERVICE_ROLE_KEY|VAULT_ENCRYPTION_KEY|EXECUTOR_SIGNING_SECRET)\b/i, 'secret environment variable name'],
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

check('schema version', evidence.schemaVersion === 'vaultproof.enterprise.productionEvidence.v1', `got ${evidence.schemaVersion}`);
check('generated timestamp', Boolean(evidence.generatedAt), 'missing generatedAt');
check('enterprise URL', String(get('inputs.enterpriseUrl', '')).startsWith('https://enterprise.vaultproof.dev'), `got ${get('inputs.enterpriseUrl', '')}`);

const readiness = get('runtime.publicReadiness.body', {});
check('public readiness HTTP status', statusCode('runtime.publicReadiness.statusCode') === '200', `got ${statusCode('runtime.publicReadiness.statusCode')}`);
check('control plane production ready', readiness.production_ready === true, JSON.stringify(readiness.production_blockers || []));
check('control plane security profile', readiness.security_profile === 'azure-confidential-production', `got ${readiness.security_profile}`);
check('executor reachable', readiness.executor?.reachable === true, 'executor not reachable from control plane readiness');
check('executor production ready', readiness.executor?.health?.production_ready === true, JSON.stringify(readiness.executor?.health?.production_blockers || []));
check('executor hardware-bound key release', readiness.executor?.health?.key_release_hardware_bound === true, 'key release is not hardware-bound');
check('executor attestation evidence ready', readiness.executor?.health?.attestation_evidence_ready === true, 'attestation evidence is not ready');

const securityProfile = get('azure.vmSecurity.securityProfile', {});
check('VM is ConfidentialVM', securityProfile.securityType === 'ConfidentialVM', `got ${securityProfile.securityType}`);
check('VM secure boot enabled', securityProfile.uefiSettings?.secureBootEnabled === true, 'secure boot is not true');
check('VM vTPM enabled', securityProfile.uefiSettings?.vTpmEnabled === true, 'vTPM is not true');
check('VM managed identity present', get('azure.vmSecurity.identity.type') === 'SystemAssigned', `got ${get('azure.vmSecurity.identity.type')}`);

const route = get('azure.frontDoorRoute', {});
check('Front Door route enabled', route.enabledState === 'Enabled', `got ${route.enabledState}`);
check('Front Door HTTPS redirect enabled', route.httpsRedirect === 'Enabled', `got ${route.httpsRedirect}`);
warn('Front Door origin forwarding is HTTPS', route.forwardingProtocol === 'HttpsOnly', `current forwardingProtocol is ${route.forwardingProtocol || 'unknown'}`);

const origins = Array.isArray(get('azure.frontDoorOrigins')) ? get('azure.frontDoorOrigins') : [];
const enabledOrigins = origins.filter(isEnabledOrigin);
check('Front Door has enabled origin', enabledOrigins.length > 0, 'no enabled origins found');
check(
  'Front Door does not use old Container Apps origin',
  enabledOrigins.every((origin) => !originHost(origin).endsWith('.azurecontainerapps.io')),
  JSON.stringify(enabledOrigins.map(originHost)),
);

const directPublicStatus = statusCode('runtime.directPublicOrigin.statusCode');
check('direct public VM origin is blocked', directPublicStatus !== '200', `direct origin returned ${directPublicStatus}`);

const sshChecks = get('runtime.sshChecks', {});
if (sshChecks.skipped === true) {
  warnings.push({ name: 'SSH evidence checks skipped', detail: 'RUN_SSH_CHECKS=false' });
} else {
  check('executor service active', sshChecks.services?.executor === 'active', `got ${sshChecks.services?.executor}`);
  check('control-plane service active', sshChecks.services?.controlPlane === 'active', `got ${sshChecks.services?.controlPlane}`);
  check('loopback readiness production ready', sshChecks.loopbackReadiness?.production_ready === true, 'loopback readiness is not production-ready');
  check('private origin without Front Door ID rejected', String(sshChecks.privateOriginWithoutFrontDoorId?.statusCode || '') === '403', `got ${sshChecks.privateOriginWithoutFrontDoorId?.statusCode}`);
}

const nsgRules = Array.isArray(get('azure.nsgRules')) ? get('azure.nsgRules') : [];
const broadControlPlaneAllows = nsgRules.filter((rule) => {
  return String(rule?.direction || '').toLowerCase() === 'inbound'
    && String(rule?.access || '').toLowerCase() === 'allow'
    && hasPort(rule, '3001')
    && hasBroadSource(rule);
});
check('no broad public NSG allow for control-plane port 3001', broadControlPlaneAllows.length === 0, JSON.stringify(broadControlPlaneAllows.map((rule) => rule.name)));

const secretFindings = collectSecretFindings(evidence);
check('evidence bundle contains no obvious secret material', secretFindings.length === 0, JSON.stringify(secretFindings.slice(0, 10)));

const result = {
  status: failures.length ? 'failed' : 'ok',
  evidencePath,
  checks: {
    failures: failures.length,
    warnings: warnings.length,
  },
  warnings,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length) {
  process.exit(1);
}
