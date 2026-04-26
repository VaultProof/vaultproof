import type { OrganizationRole } from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from '../config.js';
import {
  authenticateUser,
  hasRequiredOrganizationRole,
  resolveOrganizationMembership,
} from '../auth.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import { getSupabase } from '../supabase.js';

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function getUserEmailMap(env: EnterpriseControlPlaneEnv, userIds: string[]): Promise<Map<string, string | null>> {
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
  env: EnterpriseControlPlaneEnv,
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

export async function handleEnterpriseMemberRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }

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

  if (method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'members' && !membership) {
    return Response.json({
      organization: null,
      members: [],
      invitations: [],
      projects: [],
      pending_invitations_for_me: pendingInvitationsForMe,
    });
  }

  if (method === 'POST' && pathSegments.length === 4 && pathSegments[0] === 'members' && pathSegments[1] === 'invitations' && pathSegments[3] === 'accept') {
    const invitationId = pathSegments[2];
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

  if (method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'members') {
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
      role: string;
      created_at: string;
    }>>();

    for (const assignment of (projectMembers || []) as Array<{
      project_id: string;
      user_id: string;
      role: string;
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

  return null;
}
