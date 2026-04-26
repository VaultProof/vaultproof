#!/usr/bin/env node

const SUPABASE_URL = 'https://gwzkjiomemjlhtrdrlan.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function extractAccessToken(raw) {
  if (!raw) return null;
  if (raw.startsWith('eyJ')) return raw;
  try {
    return JSON.parse(raw).access_token || null;
  } catch {
    return null;
  }
}

async function rest(path, token) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  return { status: response.status, ok: response.ok, body };
}

const token = extractAccessToken(await readStdin());
if (!token) {
  console.error('No access_token found on stdin.');
  process.exit(1);
}

for (const path of [
  'organizations?select=id,name,slug,kind&order=created_at.desc&limit=5',
  'organization_members?select=organization_id,user_id,role&limit=5',
  'projects?select=id,vp_proj_id,name,organization_id&order=created_at.desc&limit=5',
  'project_keys?select=id,project_id,provider,slug,share2_b64&limit=1',
  'project_keys?select=id,project_id,provider,slug,share2_encrypted&limit=1',
]) {
  const result = await rest(path, token);
  console.log(JSON.stringify({ path, status: result.status, ok: result.ok, body: result.body }, null, 2));
}
