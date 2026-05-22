#!/usr/bin/env tsx
import { generateKeyPairSync } from 'node:crypto';
import {
  AUDIT_CHAIN_GENESIS_HASH,
  buildAuditChainProof,
  buildProjectAccessLogAuditEvent,
  canonicalJson,
  extractAuditChainProof,
  sha256Hex,
  verifyEd25519AuditSignature,
} from './audit-chain.js';
import type { Env } from '../types.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function testEnv(privateKeyB64?: string): Env {
  return {
    ALLOWED_ORIGINS: '*',
    VAULT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    RATE_LIMITER: {} as DurableObjectNamespace,
    AUDIT_CHAIN_ED25519_PRIVATE_KEY_B64: privateKeyB64,
    AUDIT_CHAIN_KEY_ID: 'test-key',
  };
}

const baseLog = {
  project_id: 'project-1',
  project_key_id: 'key-1',
  slug: 'openai',
  provider: 'openai',
  method: 'POST',
  upstream_path: '/v1/chat/completions',
  status_code: 200,
  latency_ms: 42,
  error: null,
  metadata: { upstream_request_id: 'req_123' },
  timestamp: '2026-05-21T01:02:03.000Z',
};

console.log('── audit-chain canonicalization ──');
{
  const a = canonicalJson({ b: 2, a: { z: 1, y: 2 } });
  const b = canonicalJson({ a: { y: 2, z: 1 }, b: 2 });
  ok('canonical JSON is stable', a === b);

  const event1 = buildProjectAccessLogAuditEvent(baseLog);
  const event2 = buildProjectAccessLogAuditEvent({
    ...baseLog,
    metadata: { audit_chain: { ignored: true }, upstream_request_id: 'req_123' },
  });
  ok('audit_chain metadata is excluded from event hash', canonicalJson(event1) === canonicalJson(event2));

  const changedPath = buildProjectAccessLogAuditEvent({ ...baseLog, upstream_path: '/v1/models' });
  ok('path changes alter event', event1.upstream_path_hash !== changedPath.upstream_path_hash);
}

console.log('── audit-chain proofs ──');
{
  const first = buildAuditChainProof(baseLog, null, testEnv());
  ok('first event uses genesis hash', first.previous_hash === AUDIT_CHAIN_GENESIS_HASH);
  ok('unsigned proof still has event hash', /^[a-f0-9]{64}$/u.test(first.event_hash));
  ok('unsigned proof still has chain hash', /^[a-f0-9]{64}$/u.test(first.chain_hash));

  const second = buildAuditChainProof({ ...baseLog, timestamp: '2026-05-21T01:02:04.000Z' }, first.chain_hash, testEnv());
  ok('second event links to first chain hash', second.previous_hash === first.chain_hash);

  const extracted = extractAuditChainProof({ audit_chain: second });
  ok('extracts valid proof from metadata', extracted?.chain_hash === second.chain_hash);
}

console.log('── audit-chain signatures ──');
{
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const proof = buildAuditChainProof(baseLog, null, testEnv(privateKeyB64));

  ok('signed proof uses ed25519', proof.signature_algorithm === 'ed25519');
  ok('signed proof carries configured key id', proof.signature_key_id === 'test-key');
  ok('signature is present', typeof proof.signature === 'string' && proof.signature.length > 40);
  ok(
    'signature verifies with public key',
    Boolean(proof.signature && verifyEd25519AuditSignature(proof.chain_hash, proof.signature, publicKeyB64)),
  );
  ok(
    'signature rejects tampered hash',
    !proof.signature || !verifyEd25519AuditSignature(sha256Hex('tampered'), proof.signature, publicKeyB64),
  );
}

if (failed) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\n${passed} passed, 0 failed`);
