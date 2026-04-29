import {
  hasRequiredAccessRole,
  normalizeSlug,
  type StartedOrganizationSsoBody,
  isValidDomain,
  normalizeDomain,
  validateStartedOrganizationSsoInput,
} from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from '../config.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import {
  authenticateUser,
  listOrganizationMemberships,
  resolveOrganizationMembership,
  resolveRequestedSsoDomain,
  type ResolveOrganizationSsoBody,
} from '../auth.js';
import { getSupabase } from '../supabase.js';

interface ConfiguredSsoOrganization {
  organization_id: string;
  company_domain: string;
  sso_provider: string | null;
  login_mode: string | null;
  status: string;
}

interface UpdateOrganizationSsoSettingsBody {
  company_domain?: string | null;
  sso_provider?: string | null;
  status?: 'requested' | 'configured' | null;
  login_mode?: 'sso-first' | 'assisted' | null;
}

interface CreateOrganizationBody {
  name?: string;
  slug?: string | null;
}

interface UpdateOrganizationBody {
  name?: string;
  slug?: string | null;
}

interface ArchiveOrganizationBody {
  confirmation_name?: string;
}

interface TransferOwnershipBody {
  target_user_id?: string;
}

async function findConfiguredSsoOrganizationByDomain(
  env: EnterpriseControlPlaneEnv,
  companyDomain: string,
): Promise<ConfiguredSsoOrganization | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_sso_settings')
    .select('organization_id, company_domain, sso_provider, login_mode, status')
    .eq('company_domain', companyDomain)
    .eq('status', 'configured')
    .maybeSingle();

  return data || null;
}

async function fetchOrganizationSsoSettings(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<{
  company_domain: string;
  sso_provider: string | null;
  login_mode: string;
  status: string;
  created_at: string;
  updated_at: string;
} | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_sso_settings')
    .select('company_domain, sso_provider, login_mode, status, created_at, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();

  return data || null;
}

async function fetchOrganizationSsoStatus(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
  ssoSettings: {
    company_domain: string;
    sso_provider: string | null;
    login_mode: string;
    status: string;
    created_at: string;
    updated_at: string;
  } | null,
): Promise<{
  provider_status: 'not_started' | 'requested' | 'configured';
  company_domain: string | null;
  sso_provider: string | null;
  login_mode: 'sso-first' | 'assisted' | null;
  last_started_sso_login_at: string | null;
  last_started_sso_login_email: string | null;
  last_successful_sso_login_at: string | null;
  last_successful_sso_login_email: string | null;
  last_membership_resolution_at: string | null;
  last_membership_resolution: string | null;
  last_membership_resolution_email: string | null;
}> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_audit_events')
    .select('event_type, actor_email, metadata, created_at')
    .eq('organization_id', organizationId)
    .in('event_type', ['organization_sso_login_started', 'organization_sso_login_completed', 'organization_sso_membership_resolved'])
    .order('created_at', { ascending: false })
    .limit(20);

  const events = (data || []) as Array<{
    event_type: string;
    actor_email: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;

  const latestSuccessfulLogin = events.find((event) => {
    if (event.event_type !== 'organization_sso_login_completed') return false;
    const resolution = String(event.metadata?.resolution || '');
    return resolution === 'existing_membership' || resolution === 'accepted_invitation';
  }) || null;

  const latestStartedLogin = events.find((event) => event.event_type === 'organization_sso_login_started') || null;
  const latestMembershipResolution = events.find((event) => event.event_type === 'organization_sso_membership_resolved') || null;

  return {
    provider_status: ssoSettings
      ? (ssoSettings.status === 'configured' ? 'configured' : 'requested')
      : 'not_started',
    company_domain: ssoSettings?.company_domain || null,
    sso_provider: ssoSettings?.sso_provider || null,
    login_mode: (ssoSettings?.login_mode === 'assisted' || ssoSettings?.login_mode === 'sso-first')
      ? ssoSettings.login_mode
      : null,
    last_started_sso_login_at: latestStartedLogin?.created_at || null,
    last_started_sso_login_email: latestStartedLogin?.actor_email || null,
    last_successful_sso_login_at: latestSuccessfulLogin?.created_at || null,
    last_successful_sso_login_email: latestSuccessfulLogin?.actor_email || null,
    last_membership_resolution_at: latestMembershipResolution?.created_at || null,
    last_membership_resolution: String(latestMembershipResolution?.metadata?.resolution || '') || null,
    last_membership_resolution_email: latestMembershipResolution?.actor_email || null,
  };
}

export async function handleEnterpriseOrganizationRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);

  if (request.method === 'POST' && pathSegments.length === 2 && pathSegments[0] === 'orgs' && pathSegments[1] === 'sso-started') {
    let body: StartedOrganizationSsoBody = {};
    try {
      body = (await request.json()) as StartedOrganizationSsoBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validated = validateStartedOrganizationSsoInput(body);
    if (!validated.ok) {
      return Response.json({ error: validated.error }, { status: 400 });
    }

    if (!supabaseConfigured) {
      return Response.json(
        {
          error: 'Enterprise org routes are not configured yet.',
        },
        { status: 501 },
      );
    }

    const effectiveDomain = validated.value.companyDomain;
    const email = validated.value.email;
    const configuredSso = await findConfiguredSsoOrganizationByDomain(env, effectiveDomain);
    if (!configuredSso) {
      return Response.json({
        accepted: true,
        matched: false,
        company_domain: effectiveDomain,
      });
    }

    const supabase = getSupabase(env);
    const { data: organization } = await supabase
      .from('organizations')
      .select('id, kind')
      .eq('id', configuredSso.organization_id)
      .eq('kind', 'team')
      .is('archived_at', null)
      .maybeSingle();

    if (!organization) {
      return Response.json({
        accepted: true,
        matched: false,
        company_domain: effectiveDomain,
      });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: organization.id,
      actor_user_id: null,
      actor_email: email,
      event_type: 'organization_sso_login_started',
      target_type: 'organization',
      target_id: organization.id,
      description: `Started SSO login for ${effectiveDomain}`,
      metadata: {
        company_domain: effectiveDomain,
        sso_provider: configuredSso.sso_provider,
        login_mode: configuredSso.login_mode,
        started_via: 'enterprise_control_plane',
      },
    });

    return Response.json({
      accepted: true,
      matched: true,
      company_domain: effectiveDomain,
      login_mode: configuredSso.login_mode || null,
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'GET' &&
    pathSegments.length === 1 &&
    pathSegments[0] === 'orgs'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const supabase = getSupabase(env);
    const memberships = await listOrganizationMemberships(env, auth.userId);
    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    const { data: archivedOrganizations } = await supabase
      .from('organizations')
      .select('id, name, kind, archived_at')
      .eq('owner_user_id', auth.userId)
      .eq('kind', 'team')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });

    return Response.json({
      organizations: memberships.map((membership) => ({
        id: membership.organization_id,
        name: membership.organization_name,
        kind: membership.organization_kind,
        role: membership.organization_role,
        is_active: activeMembership?.organization_id === membership.organization_id,
      })),
      archived_organizations: (archivedOrganizations || []).map((organization) => ({
        id: organization.id,
        name: organization.name,
        kind: organization.kind,
        role: 'owner',
        archived_at: organization.archived_at,
      })),
      active_organization_id: activeMembership?.organization_id || null,
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'POST' &&
    pathSegments.length === 1 &&
    pathSegments[0] === 'orgs'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    let body: CreateOrganizationBody;
    try {
      body = (await request.json()) as CreateOrganizationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = body.name?.trim();
    if (!name || name.length < 2) {
      return Response.json({ error: 'Organization name must be at least 2 characters' }, { status: 400 });
    }

    const requestedSlug = body.slug ? normalizeSlug(body.slug) : normalizeSlug(name);
    const slug = requestedSlug || null;
    const supabase = getSupabase(env);

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name,
        slug,
        kind: 'team',
        owner_user_id: auth.userId,
      })
      .select('id, name, slug, kind, owner_user_id, created_at')
      .single();

    if (orgError || !organization) {
      const message = orgError?.message?.includes('organizations_slug_lower_uidx')
        ? 'That organization slug is already taken'
        : 'Failed to create organization';
      return Response.json({ error: message }, { status: 400 });
    }

    const { error: membershipError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: auth.userId,
        role: 'owner',
        invited_by: auth.userId,
      });

    if (membershipError) {
      return Response.json({ error: 'Failed to initialize organization membership' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: organization.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_created',
      target_type: 'organization',
      target_id: organization.id,
      description: `Created organization ${organization.name}`,
      metadata: {
        name: organization.name,
        slug: organization.slug,
        kind: organization.kind,
      },
    });

    return Response.json({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        kind: organization.kind,
        role: 'owner',
      },
    }, { status: 201 });
  }

  if (
    supabaseConfigured &&
    request.method === 'GET' &&
    pathSegments.length === 2 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    const supabase = getSupabase(env);
    const [{ data: organization }, { count: memberCount }, { count: projectCount }] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at, archived_by_user_id')
        .eq('id', activeMembership.organization_id)
        .is('archived_at', null)
        .single(),
      supabase
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', activeMembership.organization_id),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', activeMembership.organization_id)
        .is('revoked_at', null),
    ]);

    if (!organization) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    const ssoSettings = organization.kind === 'team'
      ? await fetchOrganizationSsoSettings(env, activeMembership.organization_id)
      : null;

    const ssoStatus = organization.kind === 'team'
      ? await fetchOrganizationSsoStatus(env, activeMembership.organization_id, ssoSettings)
      : null;

    return Response.json({
      organization: {
        ...organization,
        role: activeMembership.organization_role,
        member_count: memberCount || 0,
        project_count: projectCount || 0,
        can_archive: activeMembership.organization_role === 'owner' && organization.kind === 'team',
        can_transfer_ownership: activeMembership.organization_role === 'owner' && organization.kind === 'team',
      },
      sso_settings: ssoSettings,
      sso_status: ssoStatus,
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'PUT' &&
    pathSegments.length === 2 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!hasRequiredAccessRole(activeMembership.organization_role, 'admin')) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: UpdateOrganizationBody;
    try {
      body = (await request.json()) as UpdateOrganizationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const updates: { name?: string; slug?: string | null; updated_at?: string } = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2) {
        return Response.json({ error: 'Organization name must be at least 2 characters' }, { status: 400 });
      }
      updates.name = name;
    }
    if (body.slug !== undefined) {
      updates.slug = body.slug ? normalizeSlug(body.slug) : null;
    }
    if (!Object.keys(updates).length) {
      return Response.json({ error: 'No organization updates provided' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();
    const supabase = getSupabase(env);
    const { data: updated, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', activeMembership.organization_id)
      .select('id, name, slug, kind, owner_user_id, created_at, updated_at')
      .is('archived_at', null)
      .single();

    if (error || !updated) {
      const message = error?.message?.includes('organizations_slug_lower_uidx')
        ? 'That organization slug is already taken'
        : 'Failed to update organization';
      return Response.json({ error: message }, { status: 400 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: activeMembership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_updated',
      target_type: 'organization',
      target_id: updated.id,
      description: `Updated organization ${updated.name}`,
      metadata: {
        name: updated.name,
        slug: updated.slug,
      },
    });

    return Response.json({
      organization: {
        ...updated,
        role: activeMembership.organization_role,
      },
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'POST' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current' &&
    pathSegments[2] === 'archive'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_role !== 'owner') {
      return Response.json({ error: 'Only the organization owner can archive this organization' }, { status: 403 });
    }

    const supabase = getSupabase(env);
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id, name, kind')
      .eq('id', activeMembership.organization_id)
      .is('archived_at', null)
      .maybeSingle();

    if (!existingOrg) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (existingOrg.kind !== 'team') {
      return Response.json({ error: 'Personal organizations cannot be archived from this flow' }, { status: 400 });
    }

    let body: ArchiveOrganizationBody;
    try {
      body = (await request.json()) as ArchiveOrganizationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const confirmationName = body.confirmation_name?.trim() || '';
    if (confirmationName !== existingOrg.name) {
      return Response.json({ error: 'Confirmation name must match the organization name exactly' }, { status: 400 });
    }

    const archivedAt = new Date().toISOString();
    const { error: archiveError } = await supabase
      .from('organizations')
      .update({
        archived_at: archivedAt,
        archived_by_user_id: auth.userId,
        updated_at: archivedAt,
      })
      .eq('id', activeMembership.organization_id)
      .is('archived_at', null);

    if (archiveError) {
      return Response.json({ error: 'Failed to archive organization' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: activeMembership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_archived',
      target_type: 'organization',
      target_id: activeMembership.organization_id,
      description: `Archived organization ${existingOrg.name}`,
      metadata: {
        name: existingOrg.name,
      },
    });

    return Response.json({
      ok: true,
      archived_organization_id: activeMembership.organization_id,
      archived_at: archivedAt,
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'POST' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current' &&
    pathSegments[2] === 'transfer-ownership'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_role !== 'owner') {
      return Response.json({ error: 'Only the organization owner can transfer ownership' }, { status: 403 });
    }
    if (activeMembership.organization_kind !== 'team') {
      return Response.json({ error: 'Personal organizations cannot transfer ownership' }, { status: 400 });
    }

    let body: TransferOwnershipBody;
    try {
      body = (await request.json()) as TransferOwnershipBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const targetUserId = body.target_user_id?.trim();
    if (!targetUserId) {
      return Response.json({ error: 'target_user_id is required' }, { status: 400 });
    }
    if (targetUserId === auth.userId) {
      return Response.json({ error: 'Transfer target must be different from the current owner' }, { status: 400 });
    }

    const supabase = getSupabase(env);
    const { data: targetMember, error: targetMemberError } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('organization_id', activeMembership.organization_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (targetMemberError || !targetMember) {
      return Response.json({ error: 'Target user must already be an organization member' }, { status: 404 });
    }
    if (targetMember.role === 'owner') {
      return Response.json({ error: 'That member is already an owner' }, { status: 400 });
    }

    const { error: transferError } = await supabase.rpc('transfer_organization_ownership', {
      p_organization_id: activeMembership.organization_id,
      p_current_owner_user_id: auth.userId,
      p_target_owner_user_id: targetUserId,
    });

    if (transferError) {
      return Response.json({ error: 'Failed to transfer organization ownership' }, { status: 500 });
    }

    const [{ data: updatedOrg }, { data: updatedTargetMember }] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, kind, owner_user_id, created_at, updated_at')
        .eq('id', activeMembership.organization_id)
        .single(),
      supabase
        .from('organization_members')
        .select('id, user_id, role')
        .eq('organization_id', activeMembership.organization_id)
        .eq('user_id', targetUserId)
        .single(),
    ]);

    await writeGovernanceAuditEvent(env, {
      organization_id: activeMembership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_ownership_transferred',
      target_type: 'organization',
      target_id: activeMembership.organization_id,
      description: `Transferred organization ownership to ${targetUserId}`,
      metadata: {
        previous_owner_user_id: auth.userId,
        new_owner_user_id: targetUserId,
        previous_owner_role: 'owner',
        new_owner_previous_role: targetMember.role,
      },
    });

    return Response.json({
      organization: updatedOrg ? {
        ...updatedOrg,
        role: 'admin',
      } : null,
      transferred_to: updatedTargetMember || { user_id: targetUserId, role: 'owner' },
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'POST' &&
    pathSegments.length === 2 &&
    pathSegments[1] === 'unarchive'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const organizationId = pathSegments[0];
    const supabase = getSupabase(env);
    const { data: archivedOrg } = await supabase
      .from('organizations')
      .select('id, name, kind, owner_user_id, archived_at')
      .eq('id', organizationId)
      .not('archived_at', 'is', null)
      .maybeSingle();

    if (!archivedOrg) {
      return Response.json({ error: 'Archived organization not found' }, { status: 404 });
    }
    if (archivedOrg.owner_user_id !== auth.userId) {
      return Response.json({ error: 'Only the organization owner can restore this organization' }, { status: 403 });
    }
    if (archivedOrg.kind !== 'team') {
      return Response.json({ error: 'Only archived team organizations can be restored from this flow' }, { status: 400 });
    }

    const restoredAt = new Date().toISOString();
    const { data: updatedOrg, error: restoreError } = await supabase
      .from('organizations')
      .update({
        archived_at: null,
        archived_by_user_id: null,
        updated_at: restoredAt,
      })
      .eq('id', organizationId)
      .not('archived_at', 'is', null)
      .select('id, name, slug, kind, owner_user_id, created_at, updated_at')
      .single();

    if (restoreError || !updatedOrg) {
      return Response.json({ error: 'Failed to restore organization' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: organizationId,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_unarchived',
      target_type: 'organization',
      target_id: organizationId,
      description: `Restored organization ${updatedOrg.name}`,
      metadata: {
        name: updatedOrg.name,
      },
    });

    return Response.json({
      organization: {
        ...updatedOrg,
        role: 'owner',
      },
    });
  }

  if (
    supabaseConfigured &&
    request.method === 'GET' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current' &&
    pathSegments[2] === 'sso-settings'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_kind !== 'team') {
      return Response.json({ error: 'SSO settings are only available on shared team organizations' }, { status: 400 });
    }

    const ssoSettings = await fetchOrganizationSsoSettings(env, activeMembership.organization_id);
    const ssoStatus = await fetchOrganizationSsoStatus(env, activeMembership.organization_id, ssoSettings);
    return Response.json({ sso_settings: ssoSettings, sso_status: ssoStatus });
  }

  if (
    supabaseConfigured &&
    request.method === 'PUT' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'orgs' &&
    pathSegments[1] === 'current' &&
    pathSegments[2] === 'sso-settings'
  ) {
    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_kind !== 'team') {
      return Response.json({ error: 'SSO settings are only available on shared team organizations' }, { status: 400 });
    }
    if (!hasRequiredAccessRole(activeMembership.organization_role, 'admin')) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: UpdateOrganizationSsoSettingsBody;
    try {
      body = (await request.json()) as UpdateOrganizationSsoSettingsBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const companyDomain = normalizeDomain(body.company_domain || '');
    const ssoProvider = body.sso_provider?.trim() || null;
    const status = body.status || 'requested';
    const loginMode = body.login_mode === 'assisted' ? 'assisted' : 'sso-first';
    const supabase = getSupabase(env);

    if (!companyDomain) {
      const { error } = await supabase
        .from('organization_sso_settings')
        .delete()
        .eq('organization_id', activeMembership.organization_id);
      if (error) {
        return Response.json({ error: 'Failed to clear SSO settings' }, { status: 500 });
      }

      await writeGovernanceAuditEvent(env, {
        organization_id: activeMembership.organization_id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'organization_sso_settings_cleared',
        target_type: 'organization',
        target_id: activeMembership.organization_id,
        description: 'Cleared organization SSO rollout settings',
      });

      return Response.json({ sso_settings: null });
    }

    if (!isValidDomain(companyDomain)) {
      return Response.json({ error: 'company_domain must be a valid domain' }, { status: 400 });
    }
    if (status !== 'requested' && status !== 'configured') {
      return Response.json({ error: 'status must be requested or configured' }, { status: 400 });
    }
    if (body.login_mode && body.login_mode !== 'sso-first' && body.login_mode !== 'assisted') {
      return Response.json({ error: 'login_mode must be assisted or sso-first' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('organization_sso_settings')
      .upsert({
        organization_id: activeMembership.organization_id,
        company_domain: companyDomain,
        sso_provider: ssoProvider,
        admin_email: null,
        status,
        login_mode: loginMode,
        updated_at: now,
      }, { onConflict: 'organization_id' })
      .select('company_domain, sso_provider, login_mode, status, created_at, updated_at')
      .single();

    if (error || !data) {
      const message = error?.message?.includes('organization_sso_settings_domain_lower_uidx')
        ? 'That company domain is already linked to another organization'
        : 'Failed to save SSO settings';
      return Response.json({ error: message }, { status: 400 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: activeMembership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_sso_settings_updated',
      target_type: 'organization',
      target_id: activeMembership.organization_id,
      description: `Updated SSO rollout settings for ${companyDomain}`,
      metadata: {
        company_domain: companyDomain,
        sso_provider: ssoProvider,
        login_mode: loginMode,
        status,
      },
    });

    const ssoStatus = await fetchOrganizationSsoStatus(env, activeMembership.organization_id, data);
    return Response.json({ sso_settings: data, sso_status: ssoStatus });
  }

  if (request.method === 'POST' && pathSegments.length === 2 && pathSegments[0] === 'orgs' && pathSegments[1] === 'resolve-sso') {
    if (!supabaseConfigured) {
      return Response.json(
        {
          error: 'Enterprise org routes are not configured yet.',
        },
        { status: 501 },
      );
    }

    const auth = await authenticateUser(request, env);
    if (!auth) {
      return Response.json(
        { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
        { status: 401 },
      );
    }

    let body: ResolveOrganizationSsoBody = {};
    try {
      body = (await request.json()) as ResolveOrganizationSsoBody;
    } catch {
      body = {};
    }

    const { companyDomain } = resolveRequestedSsoDomain(auth.email, body);
    if (!companyDomain) {
      return Response.json({
        resolution: 'no_match',
        company_domain: null,
      });
    }

    const configuredSso = await findConfiguredSsoOrganizationByDomain(env, companyDomain);
    if (!configuredSso) {
      return Response.json({
        resolution: 'no_match',
        company_domain: companyDomain,
      });
    }

    const supabase = getSupabase(env);
    const { data: organization } = await supabase
      .from('organizations')
      .select('id, name, kind')
      .eq('id', configuredSso.organization_id)
      .eq('kind', 'team')
      .is('archived_at', null)
      .maybeSingle();

    if (!organization) {
      return Response.json({
        resolution: 'no_match',
        company_domain: companyDomain,
      });
    }

    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organization.id)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (existingMembership?.role) {
      await writeGovernanceAuditEvent(env, {
        organization_id: organization.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'organization_sso_login_completed',
        target_type: 'organization',
        target_id: organization.id,
        description: `Completed SSO login for ${companyDomain}`,
        metadata: {
          company_domain: companyDomain,
          sso_provider: configuredSso.sso_provider,
          resolution: 'existing_membership',
          role: existingMembership.role,
        },
      });

      await writeGovernanceAuditEvent(env, {
        organization_id: organization.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'organization_sso_membership_resolved',
        target_type: 'organization',
        target_id: organization.id,
        description: `Resolved SSO login into existing ${existingMembership.role} membership`,
        metadata: {
          company_domain: companyDomain,
          sso_provider: configuredSso.sso_provider,
          resolution: 'existing_membership',
          role: existingMembership.role,
        },
      });

      return Response.json({
        resolution: 'existing_membership',
        company_domain: companyDomain,
        organization: {
          id: organization.id,
          name: organization.name,
          kind: organization.kind,
          role: existingMembership.role,
        },
      });
    }

    const normalizedEmail = auth.email.trim().toLowerCase();
    const { data: invitation } = await supabase
      .from('organization_invitations')
      .select('id, role, invited_by')
      .eq('organization_id', organization.id)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (!invitation) {
      await writeGovernanceAuditEvent(env, {
        organization_id: organization.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'organization_sso_login_completed',
        target_type: 'organization',
        target_id: organization.id,
        description: `Completed SSO login for ${companyDomain} without an active membership`,
        metadata: {
          company_domain: companyDomain,
          sso_provider: configuredSso.sso_provider,
          resolution: 'pending_access',
        },
      });

      return Response.json({
        resolution: 'pending_access',
        company_domain: companyDomain,
        organization: {
          id: organization.id,
          name: organization.name,
          kind: organization.kind,
        },
      });
    }

    const { error: membershipError } = await supabase
      .from('organization_members')
      .upsert(
        {
          organization_id: organization.id,
          user_id: auth.userId,
          role: invitation.role,
          invited_by: invitation.invited_by || auth.userId,
        },
        { onConflict: 'organization_id,user_id' },
      );

    if (membershipError) {
      return Response.json({ error: 'Failed to apply invited organization membership after SSO login' }, { status: 500 });
    }

    const acceptedAt = new Date().toISOString();
    const { error: acceptError } = await supabase
      .from('organization_invitations')
      .update({
        status: 'accepted',
        accepted_at: acceptedAt,
      })
      .eq('id', invitation.id);

    if (acceptError) {
      return Response.json({ error: 'Failed to finalize invitation acceptance after SSO login' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: organization.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_invitation_accepted',
      target_type: 'organization_invitation',
      target_id: invitation.id,
      description: `${auth.email} accepted an organization invite as ${invitation.role} after SSO login`,
      metadata: {
        invited_email: normalizedEmail,
        role: invitation.role,
        accepted_via: 'sso',
      },
    });

    await writeGovernanceAuditEvent(env, {
      organization_id: organization.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_sso_login_completed',
      target_type: 'organization',
      target_id: organization.id,
      description: `Completed SSO login for ${companyDomain}`,
      metadata: {
        company_domain: companyDomain,
        sso_provider: configuredSso.sso_provider,
        resolution: 'accepted_invitation',
        role: invitation.role,
      },
    });

    await writeGovernanceAuditEvent(env, {
      organization_id: organization.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_sso_membership_resolved',
      target_type: 'organization',
      target_id: organization.id,
      description: `Resolved SSO login by accepting a pending ${invitation.role} invitation`,
      metadata: {
        company_domain: companyDomain,
        sso_provider: configuredSso.sso_provider,
        resolution: 'accepted_invitation',
        role: invitation.role,
      },
    });

    return Response.json({
      resolution: 'accepted_invitation',
      company_domain: companyDomain,
      organization: {
        id: organization.id,
        name: organization.name,
        kind: organization.kind,
        role: invitation.role,
      },
    });
  }

  return null;
}
