import type { Env, OrganizationRole, ProjectRole } from '../types.js';
import {
  authenticateUser,
  hasRequiredOrganizationRole,
  resolveOrganizationMembership,
} from '../lib/user-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { writeGovernanceAuditEvent } from '../lib/audit.js';

interface InvitationBody {
  email?: string;
  role?: OrganizationRole;
}

interface MemberRoleUpdateBody {
  role?: OrganizationRole;
}

interface IncomingInvitationSummary {
  id: string;
  email: string;
  role: OrganizationRole;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  organization: {
    id: string;
    name: string;
    kind: 'personal' | 'team';
  };
}

const VALID_ROLES = new Set<OrganizationRole>(['owner', 'admin', 'member', 'viewer']);
const MANAGEABLE_INVITE_ROLES = new Set<OrganizationRole>(['admin', 'member', 'viewer']);
const MANAGEABLE_MEMBER_ROLES = new Set<OrganizationRole>(['admin', 'member', 'viewer']);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getUserEmailMap(env: Env, userIds: string[]): Promise<Map<string, string | null>> {
  const supabase = getSupabase(env);
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const results = await Promise.all(
    uniqueIds.map(async (userId) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error) return [userId, null] as const;
        return [userId, data.user?.email || null] as const;
      } catch {
        return [userId, null] as const;
      }
    }),
  );

  return new Map(results);
}

async function listPendingInvitationsForEmail(
  env: Env,
  email: string,
): Promise<IncomingInvitationSummary[]> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('organization_invitations')
    .select(`
      id,
      email,
      role,
      status,
      created_at,
      organizations!inner (
        id,
        name,
        kind
      )
    `)
    .eq('email', normalizeEmail(email))
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    email: string;
    role: OrganizationRole;
    status: 'pending' | 'accepted' | 'revoked';
    created_at: string;
    organizations: {
      id: string;
      name: string;
      kind: 'personal' | 'team';
    } | Array<{
      id: string;
      name: string;
      kind: 'personal' | 'team';
    }> | null;
  }>).map((row) => {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!organization) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      created_at: row.created_at,
      organization: {
        id: organization.id,
        name: organization.name,
        kind: organization.kind,
      },
    } satisfies IncomingInvitationSummary;
  }).filter(Boolean) as IncomingInvitationSummary[];
}

export async function handleMembers(
  request: Request,
  env: Env,
  pathSegments: string[],
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const supabase = getSupabase(env);
  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  const method = request.method;
  const pendingInvitationsForMe = await listPendingInvitationsForEmail(env, auth.email);

  if (method === 'GET' && pathSegments.length === 0 && !membership) {
    return Response.json({
      organization: null,
      members: [],
      invitations: [],
      projects: [],
      pending_invitations_for_me: pendingInvitationsForMe,
    });
  }

  if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'invitations' && pathSegments[2] === 'accept') {
    const invitationId = pathSegments[1];
    const normalizedEmail = normalizeEmail(auth.email);
    const { data: invitation, error: invitationError } = await supabase
      .from('organization_invitations')
      .select('id, organization_id, email, role, status')
      .eq('id', invitationId)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (invitationError || !invitation) {
      return Response.json({ error: 'Invitation not found' }, { status: 404 });
    }

    const { error: membershipError } = await supabase
      .from('organization_members')
      .upsert(
        {
          organization_id: invitation.organization_id as string,
          user_id: auth.userId,
          role: invitation.role as OrganizationRole,
          invited_by: auth.userId,
        },
        { onConflict: 'organization_id,user_id' },
      );

    if (membershipError) {
      return Response.json({ error: 'Failed to accept invitation' }, { status: 500 });
    }

    const { data: acceptedInvitation, error: acceptError } = await supabase
      .from('organization_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitationId)
      .select('id, organization_id, email, role, status, accepted_at')
      .single();

    if (acceptError || !acceptedInvitation) {
      return Response.json({ error: 'Failed to finalize invitation acceptance' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: invitation.organization_id as string,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_invitation_accepted',
      target_type: 'organization_invitation',
      target_id: acceptedInvitation.id,
      description: `${auth.email} accepted an organization invite as ${invitation.role}`,
      metadata: {
        invited_email: normalizedEmail,
        role: invitation.role,
      },
    });

    return Response.json({ invitation: acceptedInvitation });
  }

  if (!membership) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  const canManageMembers = hasRequiredOrganizationRole(membership.organization_role, 'admin');

  if (method === 'GET' && pathSegments.length === 0) {
    const [{ data: orgMembers }, { data: projects }, { data: invitations }] = await Promise.all([
      supabase
        .from('organization_members')
        .select('id, user_id, role, created_at')
        .eq('organization_id', membership.organization_id)
        .order('created_at', { ascending: true }),
      supabase
        .from('projects')
        .select('id, name, vp_proj_id, created_at')
        .eq('organization_id', membership.organization_id)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_invitations')
        .select('id, email, role, status, created_at, invited_by')
        .eq('organization_id', membership.organization_id)
        .in('status', ['pending', 'accepted'])
        .order('created_at', { ascending: false }),
    ]);

    const memberRows = (orgMembers || []) as Array<{
      id: string;
      user_id: string;
      role: OrganizationRole;
      created_at: string;
    }>;

    const projectRows = (projects || []) as Array<{
      id: string;
      name: string | null;
      vp_proj_id: string;
      created_at: string;
    }>;

    const projectIds = projectRows.map((project) => project.id);
    const [{ data: projectMembers }, emailMap] = await Promise.all([
      projectIds.length
        ? supabase
            .from('project_members')
            .select('project_id, user_id, role, created_at')
            .in('project_id', projectIds)
        : Promise.resolve({ data: [] }),
      getUserEmailMap(env, memberRows.map((row) => row.user_id)),
    ]);

    const projectById = new Map(projectRows.map((project) => [project.id, project]));
    const assignmentsByUserId = new Map<string, Array<{
      project_id: string;
      project_name: string | null;
      vp_proj_id: string;
      role: ProjectRole;
      created_at: string;
    }>>();

    for (const assignment of (projectMembers || []) as Array<{
      project_id: string;
      user_id: string;
      role: ProjectRole;
      created_at: string;
    }>) {
      const project = projectById.get(assignment.project_id);
      if (!project) continue;
      const items = assignmentsByUserId.get(assignment.user_id) || [];
      items.push({
        project_id: assignment.project_id,
        project_name: project.name,
        vp_proj_id: project.vp_proj_id,
        role: assignment.role,
        created_at: assignment.created_at,
      });
      assignmentsByUserId.set(assignment.user_id, items);
    }

    const members = memberRows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      email: emailMap.get(row.user_id) || null,
      role: row.role,
      created_at: row.created_at,
      project_access: (assignmentsByUserId.get(row.user_id) || []).sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    }));

    return Response.json({
      organization: {
        id: membership.organization_id,
        name: membership.organization_name,
        kind: membership.organization_kind,
        current_role: membership.organization_role,
        can_manage_members: canManageMembers,
      },
      members,
      invitations: (invitations || []) as Array<{
        id: string;
        email: string;
        role: OrganizationRole;
        status: 'pending' | 'accepted';
        created_at: string;
        invited_by: string | null;
      }>,
      projects: projectRows,
      pending_invitations_for_me: pendingInvitationsForMe,
    });
  }

  if (method === 'POST' && pathSegments.length === 1 && pathSegments[0] === 'invitations') {
    if (!canManageMembers) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: InvitationBody;
    try {
      body = (await request.json()) as InvitationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const email = normalizeEmail(body.email || '');
    const role = body.role;

    if (!email || !isValidEmail(email)) {
      return Response.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (!role || !VALID_ROLES.has(role)) {
      return Response.json({ error: 'A valid role is required' }, { status: 400 });
    }
    if (!MANAGEABLE_INVITE_ROLES.has(role)) {
      return Response.json({ error: 'Invites can only create admin, member, or viewer access for now' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('organization_invitations')
      .insert({
        organization_id: membership.organization_id,
        email,
        role,
        invited_by: auth.userId,
        status: 'pending',
      })
      .select('id, email, role, status, created_at')
      .single();

    if (error || !data) {
      const message = error?.message?.includes('organization_invitations_pending_email_uidx')
        ? 'That email already has a pending invite'
        : 'Failed to create invitation';
      return Response.json({ error: message }, { status: 400 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_invitation_created',
      target_type: 'organization_invitation',
      target_id: data.id,
      description: `Invited ${data.email} as ${data.role}`,
      metadata: {
        invited_email: data.email,
        role: data.role,
      },
    });

    return Response.json({ invitation: data }, { status: 201 });
  }

  if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'invitations') {
    if (!canManageMembers) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const invitationId = pathSegments[1];
    const { data, error } = await supabase
      .from('organization_invitations')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      })
      .eq('id', invitationId)
      .eq('organization_id', membership.organization_id)
      .eq('status', 'pending')
      .select('id, email, role, status, revoked_at')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Invitation not found' }, { status: 404 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_invitation_revoked',
      target_type: 'organization_invitation',
      target_id: data.id,
      description: `Revoked invite for ${data.email}`,
      metadata: {
        invited_email: data.email,
        role: data.role,
      },
    });

    return Response.json({ invitation: data });
  }

  if (method === 'PUT' && pathSegments.length === 1) {
    if (!canManageMembers) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const targetUserId = pathSegments[0];
    if (!targetUserId) {
      return Response.json({ error: 'Target user is required' }, { status: 400 });
    }
    if (targetUserId === auth.userId) {
      return Response.json({ error: 'Use a separate flow for changing your own organization role' }, { status: 400 });
    }

    let body: MemberRoleUpdateBody;
    try {
      body = (await request.json()) as MemberRoleUpdateBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const role = body.role;
    if (!role || !VALID_ROLES.has(role)) {
      return Response.json({ error: 'A valid role is required' }, { status: 400 });
    }
    if (!MANAGEABLE_MEMBER_ROLES.has(role)) {
      return Response.json({ error: 'Organization owner role cannot be assigned from this endpoint' }, { status: 400 });
    }

    const { data: existingMember, error: existingMemberError } = await supabase
      .from('organization_members')
      .select('id, user_id, role')
      .eq('organization_id', membership.organization_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existingMemberError || !existingMember) {
      return Response.json({ error: 'Organization member not found' }, { status: 404 });
    }
    if (existingMember.role === 'owner') {
      return Response.json({ error: 'Owner role cannot be modified from this endpoint' }, { status: 400 });
    }
    if (existingMember.role === role) {
      return Response.json({ error: 'Member already has that role' }, { status: 400 });
    }

    const { data: updatedMember, error: updateError } = await supabase
      .from('organization_members')
      .update({ role })
      .eq('id', existingMember.id)
      .eq('organization_id', membership.organization_id)
      .select('id, user_id, role, created_at')
      .single();

    if (updateError || !updatedMember) {
      return Response.json({ error: 'Failed to update organization role' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_member_role_updated',
      target_type: 'organization_member',
      target_id: updatedMember.id,
      description: `Updated organization role for ${targetUserId} to ${role}`,
      metadata: {
        target_user_id: targetUserId,
        previous_role: existingMember.role,
        role,
      },
    });

    return Response.json({ member: updatedMember });
  }

  if (method === 'DELETE' && pathSegments.length === 1) {
    if (!canManageMembers) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const targetUserId = pathSegments[0];
    if (!targetUserId) {
      return Response.json({ error: 'Target user is required' }, { status: 400 });
    }
    if (targetUserId === auth.userId) {
      return Response.json({ error: 'Use a separate flow for removing your own organization access' }, { status: 400 });
    }

    const { data: existingMember, error: existingMemberError } = await supabase
      .from('organization_members')
      .select('id, user_id, role')
      .eq('organization_id', membership.organization_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existingMemberError || !existingMember) {
      return Response.json({ error: 'Organization member not found' }, { status: 404 });
    }
    if (existingMember.role === 'owner') {
      return Response.json({ error: 'Owner cannot be removed from this endpoint' }, { status: 400 });
    }

    const { data: orgProjects } = await supabase
      .from('projects')
      .select('id')
      .eq('organization_id', membership.organization_id)
      .is('revoked_at', null);

    const projectIds = ((orgProjects || []) as Array<{ id: string }>).map((project) => project.id);
    let removedProjectAssignments = 0;
    if (projectIds.length > 0) {
      const { data: removableAssignments } = await supabase
        .from('project_members')
        .select('id')
        .in('project_id', projectIds)
        .eq('user_id', targetUserId);

      removedProjectAssignments = (removableAssignments || []).length;

      const { error: deleteAssignmentsError } = await supabase
        .from('project_members')
        .delete()
        .in('project_id', projectIds)
        .eq('user_id', targetUserId);

      if (deleteAssignmentsError) {
        return Response.json({ error: 'Failed to remove project access for member' }, { status: 500 });
      }
    }

    const { error: deleteMemberError } = await supabase
      .from('organization_members')
      .delete()
      .eq('id', existingMember.id)
      .eq('organization_id', membership.organization_id);

    if (deleteMemberError) {
      return Response.json({ error: 'Failed to remove organization member' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_member_removed',
      target_type: 'organization_member',
      target_id: existingMember.id,
      description: `Removed ${targetUserId} from organization membership`,
      metadata: {
        target_user_id: targetUserId,
        previous_role: existingMember.role,
        removed_project_assignments: removedProjectAssignments,
      },
    });

    return Response.json({
      ok: true,
      removed_user_id: targetUserId,
      removed_project_assignments: removedProjectAssignments,
    });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
