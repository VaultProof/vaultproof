#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeAuthHeaderTemplate,
  normalizeExtraHeaders,
  normalizeHeaderName,
  normalizeProviderSlug,
  normalizeUpstreamBaseUrl,
  sealProviderApiKey,
  verifySealedProviderApiKey,
} from './lib/enterprise-provider-material.mjs';

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function requireAnyEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  throw new Error(`Missing required env: one of ${names.join(', ')}`);
}

async function readOptionalFile(path) {
  if (!path) return '';
  return (await readFile(path, 'utf8')).trim();
}

async function readStdinIfAvailable() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function readProviderApiKey() {
  const fromEnv = process.env.PROVIDER_API_KEY || process.env.UPSTREAM_API_KEY || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const fromFile = await readOptionalFile(process.env.PROVIDER_API_KEY_FILE || process.env.UPSTREAM_API_KEY_FILE);
  if (fromFile) return fromFile;
  const fromStdin = await readStdinIfAvailable();
  if (fromStdin) return fromStdin;
  throw new Error('Missing provider key. Set PROVIDER_API_KEY, PROVIDER_API_KEY_FILE, or pipe the key on stdin.');
}

async function readVaultUnwrapKey() {
  const fromEnv = process.env.VAULT_UNWRAP_KEY_BASE64
    || process.env.VAULT_UNWRAP_KEY_HEX
    || process.env.VAULT_UNWRAP_KEY
    || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const fromFile = await readOptionalFile(process.env.VAULT_UNWRAP_KEY_FILE);
  if (fromFile) return fromFile;
  throw new Error('Missing vault unwrap root. Set VAULT_UNWRAP_KEY_BASE64, VAULT_UNWRAP_KEY_HEX, VAULT_UNWRAP_KEY, or VAULT_UNWRAP_KEY_FILE.');
}

function printUsageAndExit() {
  console.log(`VaultProof sealed provider slot ingest

Required for live upsert:
  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PROJECT_ID or VP_PROJECT_ID
  PROVIDER_API_KEY, PROVIDER_API_KEY_FILE, or stdin
  VAULT_UNWRAP_KEY_BASE64, VAULT_UNWRAP_KEY_HEX, VAULT_UNWRAP_KEY, or VAULT_UNWRAP_KEY_FILE

Common optional env:
  PROVIDER=openai
  PROVIDER_SLOT_SLUG=openai
  UPSTREAM_BASE_URL=https://api.openai.com
  AUTH_HEADER_NAME=authorization
  AUTH_HEADER_TEMPLATE='Bearer {key}'
  EXTRA_HEADERS_JSON='{}'
  ACTOR_EMAIL=ken@vaultproof.dev
  DRY_RUN=true
  SELF_TEST=true
`);
  process.exit(0);
}

async function runSelfTest() {
  const vaultUnwrapKey = randomBytes(32).toString('base64');
  const providerApiKey = `sk-vaultproof-self-test-${randomBytes(8).toString('hex')}`;
  const material = sealProviderApiKey(providerApiKey, vaultUnwrapKey);
  const verified = verifySealedProviderApiKey(providerApiKey, vaultUnwrapKey, material);
  if (!verified) throw new Error('Self-test failed: sealed provider material did not round-trip.');
  console.log(JSON.stringify({
    status: 'ok',
    self_test: true,
    material_mode: 'encrypted-local-seal',
    material_fingerprint: material.fingerprint,
    share_lengths: material.share_lengths,
  }, null, 2));
}

async function resolveProject(supabase, projectId, vpProjectId) {
  let query = supabase
    .from('projects')
    .select('id, vp_proj_id, name, organization_id, user_id, revoked_at')
    .is('revoked_at', null)
    .limit(1);

  query = projectId
    ? query.eq('id', projectId)
    : query.eq('vp_proj_id', vpProjectId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(projectId
      ? `Active project not found for PROJECT_ID=${projectId}`
      : `Active project not found for VP_PROJECT_ID=${vpProjectId}`);
  }
  return data;
}

async function findExistingSlot(supabase, projectId, provider) {
  const { data, error } = await supabase
    .from('project_keys')
    .select('id, provider, slug, revoked_at')
    .eq('project_id', projectId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertProviderSlot(supabase, project, row) {
  const existing = await findExistingSlot(supabase, project.id, row.provider);
  if (existing?.id) {
    const { data, error } = await supabase
      .from('project_keys')
      .update(row)
      .eq('id', existing.id)
      .select('id, project_id, provider, slug, upstream_base_url, revoked_at')
      .single();
    if (error) throw error;
    return { data, operation: 'updated' };
  }

  const { data, error } = await supabase
    .from('project_keys')
    .insert(row)
    .select('id, project_id, provider, slug, upstream_base_url, revoked_at')
    .single();
  if (error) throw error;
  return { data, operation: 'inserted' };
}

async function writeAuditEvent(supabase, project, slot, input) {
  if (!project.organization_id) return { written: false, reason: 'project_has_no_organization' };

  const { error } = await supabase.from('organization_audit_events').insert({
    organization_id: project.organization_id,
    project_id: project.id,
    actor_user_id: process.env.ACTOR_USER_ID || null,
    actor_email: process.env.ACTOR_EMAIL || null,
    event_type: 'enterprise_provider_key_sealed',
    target_type: 'project_key',
    target_id: slot.id,
    description: `Sealed live provider material for ${input.provider}/${input.slug} on ${project.name || project.vp_proj_id}`,
    metadata: {
      provider: input.provider,
      slug: input.slug,
      upstream_base_url: input.upstreamBaseUrl,
      material_mode: 'encrypted-local-seal',
      material_fingerprint: input.material.fingerprint,
      sealed_via: 'enterprise-seal-provider-slot',
    },
  });

  if (error) {
    return { written: false, warning: error.message };
  }
  return { written: true };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsageAndExit();
  }
  if (boolEnv('SELF_TEST')) {
    await runSelfTest();
    return;
  }

  const dryRun = boolEnv('DRY_RUN');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const projectId = process.env.PROJECT_ID || process.env.ENTERPRISE_PROJECT_ID || '';
  const vpProjectId = process.env.VP_PROJECT_ID || process.env.VAULTPROOF_PROJECT_REF || '';
  const shouldUseSupabase = Boolean(supabaseUrl && serviceRoleKey);
  if (!dryRun && !shouldUseSupabase) {
    requireAnyEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
    requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY']);
  }
  if (!projectId && !vpProjectId) {
    throw new Error('Missing project selector. Set PROJECT_ID or VP_PROJECT_ID.');
  }

  const provider = normalizeProviderSlug(process.env.PROVIDER || 'openai', 'PROVIDER');
  const slug = normalizeProviderSlug(process.env.PROVIDER_SLOT_SLUG || process.env.SLUG || provider, 'PROVIDER_SLOT_SLUG');
  const upstreamBaseUrl = normalizeUpstreamBaseUrl(process.env.UPSTREAM_BASE_URL || 'https://api.openai.com');
  const authHeaderName = normalizeHeaderName(process.env.AUTH_HEADER_NAME || 'authorization', 'AUTH_HEADER_NAME');
  const authHeaderTemplate = normalizeAuthHeaderTemplate(process.env.AUTH_HEADER_TEMPLATE || 'Bearer {key}');
  const extraHeaders = normalizeExtraHeaders(process.env.EXTRA_HEADERS_JSON || '');
  const providerApiKey = await readProviderApiKey();
  const vaultUnwrapKey = await readVaultUnwrapKey();
  const material = sealProviderApiKey(providerApiKey, vaultUnwrapKey);
  const verified = verifySealedProviderApiKey(providerApiKey, vaultUnwrapKey, material);
  if (!verified) throw new Error('Sealed material verification failed.');

  const row = {
    project_id: projectId || undefined,
    provider,
    slug,
    env_var: `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
    upstream_base_url: upstreamBaseUrl,
    auth_header_name: authHeaderName,
    auth_header_template: authHeaderTemplate,
    share1_encrypted: material.share1_encrypted,
    share2_encrypted: material.share2_encrypted,
    extra_headers: extraHeaders,
    revoked_at: null,
  };

  if (dryRun && !shouldUseSupabase) {
    console.log(JSON.stringify({
      status: 'dry_run',
      project_selector: projectId ? { project_id: projectId } : { vp_project_id: vpProjectId },
      provider_slot: {
        provider,
        slug,
        upstream_base_url: upstreamBaseUrl,
        auth_header_name: authHeaderName,
        extra_header_names: Object.keys(extraHeaders),
        material_mode: 'encrypted-local-seal',
        material_fingerprint: material.fingerprint,
        share_lengths: material.share_lengths,
      },
      supabase_lookup: 'skipped',
    }, null, 2));
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const project = await resolveProject(supabase, projectId, vpProjectId);
  row.project_id = project.id;

  if (dryRun) {
    console.log(JSON.stringify({
      status: 'dry_run',
      project: {
        id: project.id,
        vp_proj_id: project.vp_proj_id,
        name: project.name,
        organization_id: project.organization_id,
      },
      provider_slot: {
        provider,
        slug,
        upstream_base_url: upstreamBaseUrl,
        auth_header_name: authHeaderName,
        extra_header_names: Object.keys(extraHeaders),
        material_mode: 'encrypted-local-seal',
        material_fingerprint: material.fingerprint,
        share_lengths: material.share_lengths,
      },
      supabase_lookup: 'ok',
    }, null, 2));
    return;
  }

  const { data: slot, operation } = await upsertProviderSlot(supabase, project, row);
  const audit = await writeAuditEvent(supabase, project, slot, {
    provider,
    slug,
    upstreamBaseUrl,
    material,
  });

  console.log(JSON.stringify({
    status: 'sealed',
    operation,
    project: {
      id: project.id,
      vp_proj_id: project.vp_proj_id,
      name: project.name,
      organization_id: project.organization_id,
    },
    provider_slot: {
      key_id: slot.id,
      provider: slot.provider,
      slug: slot.slug,
      upstream_base_url: slot.upstream_base_url,
      material_mode: 'encrypted-local-seal',
      material_fingerprint: material.fingerprint,
      share_lengths: material.share_lengths,
    },
    audit_event: audit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
