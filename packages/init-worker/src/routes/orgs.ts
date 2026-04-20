import type { Env } from '../types.js';
import {
  authenticateUser,
  hasRequiredOrganizationRole,
  listOrganizationMemberships,
  resolveOrganizationMembership,
} from '../lib/user-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { writeGovernanceAuditEvent } from '../lib/audit.js';

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

interface UpdateOrganizationSsoSettingsBody {
  company_domain?: string | null;
  sso_provider?: string | null;
  status?: 'requested' | 'configured' | null;
}

interface ResolveOrganizationSsoBody {
  company_domain?: string | null;
}

function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function isValidDomain(domain: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
}

function getEmailDomain(email: string): string {
  return normalizeDomain(email.split('@').pop() || '');
}

async function fetchOrganizationSsoSettings(
  env: Env,
  organizationId: string,
): Promise<{
  company_domain: string;
  sso_provider: string | null;
  status: string;
  created_at: string;
  updated_at: string;
} | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_sso_settings')
    .select('company_domain, sso_provider, status, created_at, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  return data || null;
}

async function findConfiguredSsoOrganizationByDomain(
  env: Env,
  companyDomain: string,
): Promise<{
  organization_id: string;
  company_domain: string;
  sso_provider: string | null;
  status: string;
} | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_sso_settings')
    .select('organization_id, company_domain, sso_provider, status')
    .eq('company_domain', companyDomain)
    .eq('status', 'configured')
    .maybeSingle();
  return data || null;
}


export async function handleOrganizations(
  request: Request,
  env: Env,
  pathSegments: string[],
): Promise<Response> {
  const supabase = getSupabase(env);

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const method = request.method;

  if (method === 'GET' && pathSegments.length === 0) {
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

  if (method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'current') {
    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

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
    });
  }

  if (method === 'POST' && pathSegments.length === 1 && pathSegments[0] === 'resolve-sso') {
    let body: ResolveOrganizationSsoBody = {};
    try {
      body = (await request.json()) as ResolveOrganizationSsoBody;
    } catch {
      body = {};
    }

    const emailDomain = getEmailDomain(auth.email);
    const requestedDomain = normalizeDomain(body.company_domain || '');
    const companyDomain = requestedDomain && requestedDomain === emailDomain ? requestedDomain : emailDomain;

    if (!companyDomain || !isValidDomain(companyDomain)) {
      return Response.json({
        resolution: 'no_match',
        company_domain: companyDomain || null,
      });
    }

    const configuredSso = await findConfiguredSsoOrganizationByDomain(env, companyDomain);
    if (!configuredSso) {
      return Response.json({
        resolution: 'no_match',
        company_domain: companyDomain,
      });
    }

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

  if (method === 'POST' && pathSegments.length === 0) {
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

  if (method === 'PUT' && pathSegments.length === 1 && pathSegments[0] === 'current') {
    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!hasRequiredOrganizationRole(activeMembership.organization_role, 'admin')) {
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

  if (pathSegments.length === 2 && pathSegments[0] === 'current' && pathSegments[1] === 'sso-settings') {
    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_kind !== 'team') {
      return Response.json({ error: 'SSO settings are only available on shared team organizations' }, { status: 400 });
    }

    if (method === 'GET') {
      const ssoSettings = await fetchOrganizationSsoSettings(env, activeMembership.organization_id);
      return Response.json({ sso_settings: ssoSettings });
    }

    if (method === 'PUT') {
      if (!hasRequiredOrganizationRole(activeMembership.organization_role, 'admin')) {
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

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('organization_sso_settings')
        .upsert({
          organization_id: activeMembership.organization_id,
          company_domain: companyDomain,
          sso_provider: ssoProvider,
          admin_email: null,
          status,
          login_mode: 'sso-first',
          updated_at: now,
        }, { onConflict: 'organization_id' })
        .select('company_domain, sso_provider, status, created_at, updated_at')
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
          status,
        },
      });

      return Response.json({ sso_settings: data });
    }
  }

  if (method === 'POST' && pathSegments.length === 2 && pathSegments[0] === 'current' && pathSegments[1] === 'archive') {
    const activeMembership = await resolveOrganizationMembership(request, env, auth.userId);
    if (!activeMembership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (activeMembership.organization_role !== 'owner') {
      return Response.json({ error: 'Only the organization owner can archive this organization' }, { status: 403 });
    }

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

  if (method === 'POST' && pathSegments.length === 2 && pathSegments[0] === 'current' && pathSegments[1] === 'transfer-ownership') {
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

  if (method === 'POST' && pathSegments.length === 2 && pathSegments[1] === 'unarchive') {
    const organizationId = pathSegments[0];
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

  return Response.json({ error: 'Not found' }, { status: 404 });
}
