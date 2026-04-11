/**
 * Authentication for vp-proj-xxx project identifiers.
 *
 * Project IDs are NOT secrets — they are public identifiers that appear in
 * user .env files. Security relies on:
 *   1. Origin locking (allowed_origins registered at init time)
 *   2. Rate limiting (per-project, enforced elsewhere)
 *
 * This is distinct from the legacy `vp_live_` developer keys, which are
 * secret and can access the management API. `vp-proj-` can only hit the
 * proxy routes on this worker.
 */
import type { Env, ProjectRecord } from '../types.js';
import { getSupabase } from './supabase.js';

export interface ProjectAuth {
  project: ProjectRecord;
}

export async function authenticateProject(
  request: Request,
  env: Env,
): Promise<ProjectAuth | { error: string; status: number }> {
  const authHeader = request.headers.get('Authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();

  if (!token || !token.startsWith('vp-proj-')) {
    return { error: 'Missing or malformed project identifier. Expected `Authorization: Bearer vp-proj-...`', status: 401 };
  }

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('vp_proj_id', token)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) {
    return { error: 'Project not found or revoked', status: 401 };
  }

  // Origin check — if allowed_origins is set, enforce it.
  const project = data as ProjectRecord;
  if (project.allowed_origins) {
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
    const allowed = project.allowed_origins.split(',').map((s) => s.trim()).filter(Boolean);
    const matched = allowed.some((a) => origin.startsWith(a));
    if (!matched && project.strict_origin) {
      return { error: 'Origin not in project allowlist', status: 403 };
    }
  }

  return { project };
}
