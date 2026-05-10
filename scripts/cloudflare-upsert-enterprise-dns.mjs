#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const zoneName = process.env.CLOUDFLARE_ZONE || 'vaultproof.dev';
const recordName = process.env.CLOUDFLARE_RECORD_NAME || `enterprise.${zoneName}`;
const recordContent = process.env.CLOUDFLARE_RECORD_CONTENT || '34.102.179.105';
const proxied = process.env.CLOUDFLARE_RECORD_PROXIED === 'true';
const ttl = Number.parseInt(process.env.CLOUDFLARE_RECORD_TTL || '1', 10);

function wranglerToken() {
  try {
    const output = execFileSync('wrangler', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tokenLine = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+(?:\.[A-Za-z0-9._-]+)?$/.test(line));
    if (!tokenLine) {
      throw new Error('Wrangler token output did not contain a bearer token line.');
    }
    return tokenLine;
  } catch (error) {
    throw new Error(`Could not read Wrangler auth token: ${error.stderr || error.message}`);
  }
}

async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const errors = payload?.errors?.map((error) => error.message).join('; ') || response.statusText;
    throw new Error(`Cloudflare API ${init.method || 'GET'} ${path} failed: ${errors}`);
  }
  return payload;
}

const token = wranglerToken();

const zones = await cloudflare(`/zones?name=${encodeURIComponent(zoneName)}&status=active`);
const zone = zones.result?.[0];
if (!zone?.id) {
  throw new Error(`Could not find active Cloudflare zone ${zoneName}`);
}

const records = await cloudflare(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(recordName)}`);
const existing = Array.isArray(records.result) ? records.result : [];
const deleted = [];
const updated = [];
const created = [];

for (const record of existing) {
  if (record.type === 'A') {
    const next = await cloudflare(`/zones/${zone.id}/dns_records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        type: 'A',
        name: recordName,
        content: recordContent,
        ttl,
        proxied,
        comment: 'VaultProof GCP enterprise edge',
      }),
    });
    updated.push({
      id: next.result?.id || record.id,
      type: 'A',
      name: recordName,
      content: recordContent,
      proxied,
      ttl,
    });
    continue;
  }

  if (record.type === 'CNAME') {
    await cloudflare(`/zones/${zone.id}/dns_records/${record.id}`, { method: 'DELETE' });
    deleted.push({
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
    });
  }
}

if (updated.length === 0) {
  const next = await cloudflare(`/zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'A',
      name: recordName,
      content: recordContent,
      ttl,
      proxied,
      comment: 'VaultProof GCP enterprise edge',
    }),
  });
  created.push({
    id: next.result?.id,
    type: 'A',
    name: recordName,
    content: recordContent,
    proxied,
    ttl,
  });
}

console.log(JSON.stringify({
  status: 'ok',
  zone: zoneName,
  record: recordName,
  content: recordContent,
  proxied,
  ttl,
  deleted,
  updated,
  created,
}, null, 2));
