#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rewriteNetOpsSecretFiles, scanNetOpsSecrets } from './netops.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-netops-test-'));
fs.mkdirSync(path.join(tmp, 'group_vars'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'host_vars'), { recursive: true });

fs.writeFileSync(path.join(tmp, '.env'), [
  'MERAKI_DASHBOARD_API_KEY=meraki_secret_value',
  'NEXT_PUBLIC_MAP_KEY=not-secret',
  '',
].join('\n'));

fs.writeFileSync(path.join(tmp, 'group_vars', 'all.yml'), [
  'ansible_password: cisco-password',
  'enable_secret: enable-secret',
  'ansible_user: admin',
  '',
].join('\n'));

fs.writeFileSync(path.join(tmp, 'host_vars', 'core-1.yml'), [
  'snmp_community: private-community',
  '',
].join('\n'));

fs.writeFileSync(path.join(tmp, 'terraform.tfvars'), [
  'device_password = "terraform-password"',
  'device_hostname = "router1"',
  '',
].join('\n'));

console.log('── scan ──');
const findings = scanNetOpsSecrets(tmp);
const names = findings.map((finding) => finding.name).sort();

ok('detect ansible password', names.includes('ANSIBLE_PASSWORD'));
ok('detect enable secret', names.includes('ENABLE_SECRET'));
ok('detect scoped host snmp community', names.includes('CORE_1_SNMP_COMMUNITY'));
ok('detect terraform var', names.includes('TF_VAR_device_password'));
ok('detect netops env api key', names.includes('MERAKI_DASHBOARD_API_KEY'));
ok('skip public env key', !names.includes('NEXT_PUBLIC_MAP_KEY'));

console.log('── rewrite ──');
const results = rewriteNetOpsSecretFiles(findings);
ok('rewrite four files', results.length === 4, `got ${results.length}`);

const env = fs.readFileSync(path.join(tmp, '.env'), 'utf-8');
const groupVars = fs.readFileSync(path.join(tmp, 'group_vars', 'all.yml'), 'utf-8');
const hostVars = fs.readFileSync(path.join(tmp, 'host_vars', 'core-1.yml'), 'utf-8');
const tfvars = fs.readFileSync(path.join(tmp, 'terraform.tfvars'), 'utf-8');

ok('env placeholder', env.includes('MERAKI_DASHBOARD_API_KEY=vaultproof://MERAKI_DASHBOARD_API_KEY'));
ok('ansible password lookup', groupVars.includes('ansible_password: "{{ lookup(\'env\', \'ANSIBLE_PASSWORD\') }}"'));
ok('enable secret lookup', groupVars.includes('enable_secret: "{{ lookup(\'env\', \'ENABLE_SECRET\') }}"'));
ok('host scoped lookup', hostVars.includes('snmp_community: "{{ lookup(\'env\', \'CORE_1_SNMP_COMMUNITY\') }}"'));
ok('terraform line commented', tfvars.includes('# device_password managed by VaultProof via TF_VAR_device_password'));
ok('terraform non-secret preserved', tfvars.includes('device_hostname = "router1"'));
ok('rescan ignores rewritten secrets', scanNetOpsSecrets(tmp).length === 0);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
