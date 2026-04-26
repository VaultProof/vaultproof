import type { SecureExecutionRequest, SecureExecutionResult } from '@vaultproof/core';
import type { ResolvedSecureExecutionMaterial } from './upstream.js';
import { combineShares, decryptShare1, decryptShare2, deserializeShare, zeroUint8Array } from './crypto.js';
import type { VaultUnwrapKeyProvider } from './key-release.js';
import { getSupabase } from './supabase.js';

export interface EnterpriseExecutionMaterialResolver {
  resolveExecutionMaterial(
    request: SecureExecutionRequest,
  ): Promise<ResolvedSecureExecutionMaterial | null>;
}

export interface EnterpriseExecutionResultRecorder {
  recordExecutionResult(input: {
    request: SecureExecutionRequest;
    result: SecureExecutionResult;
  }): Promise<void>;
}

export class NullExecutionMaterialResolver implements EnterpriseExecutionMaterialResolver {
  async resolveExecutionMaterial(): Promise<ResolvedSecureExecutionMaterial | null> {
    return null;
  }
}

export class NullExecutionResultRecorder implements EnterpriseExecutionResultRecorder {
  async recordExecutionResult(): Promise<void> {
    return;
  }
}

export class SupabaseExecutionMaterialResolver implements EnterpriseExecutionMaterialResolver {
  constructor(private readonly input: {
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    keyProvider: VaultUnwrapKeyProvider;
  }) {}

  async resolveExecutionMaterial(
    request: SecureExecutionRequest,
  ): Promise<ResolvedSecureExecutionMaterial | null> {
    const supabase = getSupabase(this.input);
    const { data } = await supabase
      .from('project_keys')
      .select(`
        id,
        project_id,
        provider,
        slug,
        upstream_base_url,
        auth_header_name,
        auth_header_template,
        extra_headers,
        share1_encrypted,
        share2_encrypted,
        revoked_at
      `)
      .eq('id', request.projectKeyId)
      .eq('project_id', request.projectId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!data?.share1_encrypted || !data?.share2_encrypted) return null;
    if (!data.upstream_base_url || !data.auth_header_name || !data.auth_header_template) return null;

    let share1Plain: Uint8Array | null = null;
    let share2Plain: Uint8Array | null = null;
    let reconstructed: Uint8Array | null = null;
    try {
      const vaultEncryptionKey = await this.input.keyProvider.getVaultUnwrapKey();
      const share1CipherBytes = new Uint8Array(Buffer.from(data.share1_encrypted, 'base64'));
      const share2CipherBytes = new Uint8Array(Buffer.from(data.share2_encrypted, 'base64'));
      share1Plain = decryptShare1(share1CipherBytes, vaultEncryptionKey);
      share2Plain = decryptShare2(share2CipherBytes, vaultEncryptionKey);
      const share1 = deserializeShare(Buffer.from(share1Plain).toString('base64'));
      const share2 = deserializeShare(Buffer.from(share2Plain).toString('base64'));
      reconstructed = combineShares([share1, share2]);
      const apiKey = new TextDecoder().decode(reconstructed);

      return {
        apiKey,
        upstreamBaseUrl: data.upstream_base_url,
        authHeaderName: data.auth_header_name,
        authHeaderTemplate: data.auth_header_template,
        extraHeaders: data.extra_headers || null,
      };
    } finally {
      if (share1Plain) zeroUint8Array(share1Plain);
      if (share2Plain) zeroUint8Array(share2Plain);
      if (reconstructed) zeroUint8Array(reconstructed);
    }
  }
}

export class SupabaseExecutionResultRecorder implements EnterpriseExecutionResultRecorder {
  constructor(private readonly input: {
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
  }) {}

  async recordExecutionResult(input: {
    request: SecureExecutionRequest;
    result: SecureExecutionResult;
  }): Promise<void> {
    const supabase = getSupabase(this.input);
    await supabase.from('project_access_logs').insert({
      project_id: input.request.projectId,
      project_key_id: input.request.projectKeyId,
      slug: input.request.slug,
      provider: input.request.provider,
      method: input.request.method,
      upstream_path: input.request.upstreamPath,
      status_code: input.result.status,
      latency_ms: 0,
      error: input.result.error || null,
      metadata: {
        upstream_request_id: input.result.providerRequestId || null,
        executed_via: 'enterprise_secure_executor',
        attestation: input.result.attestation || null,
      },
    });
  }
}
