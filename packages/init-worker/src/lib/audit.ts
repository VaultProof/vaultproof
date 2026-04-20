import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

export interface GovernanceAuditEventInput {
  organization_id: string;
  project_id?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
  event_type: string;
  target_type: string;
  target_id?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function writeGovernanceAuditEvent(
  env: Env,
  input: GovernanceAuditEventInput,
): Promise<void> {
  try {
    const supabase = getSupabase(env);
    const { error } = await supabase.from('organization_audit_events').insert({
      organization_id: input.organization_id,
      project_id: input.project_id ?? null,
      actor_user_id: input.actor_user_id ?? null,
      actor_email: input.actor_email ?? null,
      event_type: input.event_type,
      target_type: input.target_type,
      target_id: input.target_id ?? null,
      description: input.description,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error('Failed to write governance audit event:', error.message);
    }
  } catch (error) {
    console.error('Failed to write governance audit event:', error);
  }
}
