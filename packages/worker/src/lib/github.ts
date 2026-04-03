import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { decrypt } from '../crypto/encryption.js';

/**
 * Make an authenticated GitHub API call and return parsed JSON.
 */
export async function githubApi(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VaultProof-Scanner/1.0',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Make an authenticated GitHub API call and return the raw Response.
 * Useful for non-JSON responses (e.g. file downloads).
 */
export async function githubApiRaw(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VaultProof-Scanner/1.0',
      ...(options?.headers || {}),
    },
  });
  return res;
}

/**
 * Retrieve and decrypt the GitHub OAuth token for a user.
 * Returns { token, connId } or null if no active connection exists.
 */
export async function getGhToken(
  env: Env,
  userId: string,
): Promise<{ token: string; connId: string } | null> {
  const supabase = getSupabase(env);

  const { data, error } = await supabase
    .from('github_connections')
    .select('id, access_token')
    .eq('user_id', userId)
    .is('disconnected_at', null)
    .limit(1)
    .single();

  if (error || !data) return null;

  // access_token is stored as base64-encoded encrypted bytes
  const encryptedBytes = new Uint8Array(
    Buffer.from(data.access_token, 'base64'),
  );
  const decryptedBytes = decrypt(encryptedBytes, env);
  const token = new TextDecoder().decode(decryptedBytes);

  return { token, connId: data.id };
}

/**
 * Log a scanner action to the scan_audit_logs table.
 * Fire-and-forget — errors are silently ignored.
 */
export function auditLog(
  env: Env,
  userId: string,
  scanId: string,
  action: string,
  metadata?: Record<string, unknown>,
): void {
  const supabase = getSupabase(env);

  // Non-blocking: intentionally not awaited
  Promise.resolve(
    supabase
      .from('scan_audit_logs')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        scan_id: scanId,
        action,
        metadata: metadata ?? null,
        created_at: new Date().toISOString(),
      }),
  )
    .then(({ error }) => {
      if (error) console.error('auditLog insert failed:', error.message);
    })
    .catch((err: unknown) => {
      console.error('auditLog error:', err);
    });
}
