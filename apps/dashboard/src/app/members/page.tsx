"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";
import { getOrganizationHeaders, ORG_EVENT_NAME, setSelectedOrganizationId } from "../../lib/org-context";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

interface MemberProjectAccess {
  project_id: string;
  project_name: string | null;
  vp_proj_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  email: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: string;
  project_access: MemberProjectAccess[];
}

interface Invitation {
  id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  status: "pending" | "accepted" | "revoked";
  created_at: string;
}

interface IncomingInvitation {
  id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  organization: {
    id: string;
    name: string;
    kind: "personal" | "team";
  };
}

interface MemberProject {
  id: string;
  name: string | null;
  vp_proj_id: string;
  created_at: string;
}

interface MembersResponse {
  organization: {
    id: string;
    name: string;
    kind: "personal" | "team";
    current_role: "owner" | "admin" | "member" | "viewer";
    can_manage_members: boolean;
  } | null;
  members: OrganizationMember[];
  invitations: Invitation[];
  projects: MemberProject[];
  pending_invitations_for_me: IncomingInvitation[];
}

const ROLE_STYLES: Record<OrganizationMember["role"], string> = {
  owner: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  admin: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  member: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  viewer: "border-white/15 bg-white/[0.06] text-slate-200",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function MembersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentBusyKey, setAssignmentBusyKey] = useState<string | null>(null);
  const [roleBusyUserId, setRoleBusyUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">("member");
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, { projectId: string; role: "admin" | "member" | "viewer" }>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, "admin" | "member" | "viewer">>({});
  const [data, setData] = useState<MembersResponse | null>(null);
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError("Dashboard auth is not configured.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (sessionData.session?.access_token) {
        setToken(sessionData.session.access_token);
        setUserEmail(sessionData.session.user?.email ?? null);
        setCurrentUserId(sessionData.session.user?.id ?? null);
      } else {
        setError("Not logged in. Sign in at vaultproof.dev first.");
        setLoading(false);
      }
    }).catch(() => {
      setError("Unable to check login status. Try refreshing.");
      setLoading(false);
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members`, {
        headers: getOrganizationHeaders(token),
      });

      if (!response.ok) {
        setError("Failed to load member data. Try refreshing.");
        return;
      }

      const payload = await response.json();
      setData(payload);
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void fetchData();
    }
  }, [token, fetchData]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void fetchData();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [fetchData, token]);

  const summary = useMemo(() => {
    const members = data?.members ?? [];
    const invitations = data?.invitations?.filter((invite) => invite.status === "pending") ?? [];
    const assignedMembers = members.filter((member) => member.project_access.length > 0).length;
    return {
      memberCount: members.length,
      pendingInvites: invitations.length,
      assignedMembers,
      projectCount: data?.projects?.length ?? 0,
      incomingInvites: data?.pending_invitations_for_me?.length ?? 0,
    };
  }, [data]);

  useEffect(() => {
    if (!data?.projects?.length) return;

    setAssignmentDrafts((current) => {
      const next = { ...current };
      for (const member of data.members) {
        if (!next[member.user_id]) {
          next[member.user_id] = {
            projectId: data.projects[0].id,
            role: "member",
          };
        }
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!data?.members?.length) return;

    setRoleDrafts((current) => {
      const next = { ...current };
      for (const member of data.members) {
        if (member.role !== "owner") {
          next[member.user_id] = member.role;
        }
      }
      return next;
    });
  }, [data]);

  async function createInvite() {
    if (!token) return;
    setSubmitting(true);
    setInviteError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members/invitations`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setInviteError(payload?.error || "Failed to create invite.");
        return;
      }

      setInviteEmail("");
      setInviteRole("member");
      setShowInviteForm(false);
      await fetchData();
    } catch {
      setInviteError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeInvite(invitationId: string) {
    if (!token) return;
    setInviteError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members/invitations/${invitationId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setInviteError(payload?.error || "Failed to revoke invite.");
        return;
      }

      await fetchData();
    } catch {
      setInviteError("Network error. Try again.");
    }
  }

  async function acceptInvitation(invitationId: string) {
    if (!token) return;
    setAcceptingInvitationId(invitationId);
    setInviteError(null);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setInviteError(payload?.error || "Failed to accept invite.");
        return;
      }

      const organizationId = payload?.invitation?.organization_id || null;
      if (organizationId) {
        setSelectedOrganizationId(organizationId);
      }
      await fetchData();
    } catch {
      setInviteError("Network error while accepting invite.");
    } finally {
      setAcceptingInvitationId(null);
    }
  }

  async function assignProjectAccess(userId: string) {
    if (!token || !data) return;
    const draft = assignmentDrafts[userId];
    if (!draft?.projectId) return;

    const busyKey = `${userId}:${draft.projectId}:assign`;
    setAssignmentBusyKey(busyKey);
    setAssignmentError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${draft.projectId}/members`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId, role: draft.role }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAssignmentError(payload?.error || "Failed to update project access.");
        return;
      }

      await fetchData();
    } catch {
      setAssignmentError("Network error while updating project access.");
    } finally {
      setAssignmentBusyKey(null);
    }
  }

  async function removeProjectAccess(projectId: string, userId: string) {
    if (!token) return;

    const busyKey = `${userId}:${projectId}:remove`;
    setAssignmentBusyKey(busyKey);
    setAssignmentError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${projectId}/members/${userId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAssignmentError(payload?.error || "Failed to remove project access.");
        return;
      }

      await fetchData();
    } catch {
      setAssignmentError("Network error while removing project access.");
    } finally {
      setAssignmentBusyKey(null);
    }
  }

  async function updateOrganizationRole(userId: string) {
    if (!token) return;
    const nextRole = roleDrafts[userId];
    if (!nextRole) return;

    setRoleBusyUserId(userId);
    setAssignmentError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members/${userId}`, {
        method: "PUT",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: nextRole }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAssignmentError(payload?.error || "Failed to update organization role.");
        return;
      }

      await fetchData();
    } catch {
      setAssignmentError("Network error while updating organization role.");
    } finally {
      setRoleBusyUserId(null);
    }
  }

  async function removeOrganizationMember(userId: string) {
    if (!token) return;

    setRemovingUserId(userId);
    setAssignmentError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/members/${userId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAssignmentError(payload?.error || "Failed to remove organization member.");
        return;
      }

      await fetchData();
    } catch {
      setAssignmentError("Network error while removing organization member.");
    } finally {
      setRemovingUserId(null);
    }
  }

  return (
    <AppShell
      eyebrow="Access evidence"
      title="Members"
      description="Review shared access across the organization, pending invites, roles, project assignments, and access-review evidence."
      actions={
        <>
          {userEmail ? (
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-200">
                {userEmail[0].toUpperCase()}
              </div>
              <div className="text-sm text-slate-300">{userEmail}</div>
            </div>
          ) : null}
          {data?.organization?.can_manage_members ? (
            <button
              onClick={() => setShowInviteForm((current) => !current)}
              className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/14"
            >
              {showInviteForm ? "Close" : "Invite member"}
            </button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Organization</div>
          <div className="mt-3 text-2xl font-bold text-white">{data?.organization?.name || "No org yet"}</div>
          <p className="mt-3 text-sm text-slate-300">Current role: {data?.organization?.current_role || "No membership"}</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Members</div>
          <div className="mt-3 text-3xl font-bold text-white">{summary.memberCount}</div>
          <p className="mt-3 text-sm text-slate-300">Verified org members with direct access context.</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned Members</div>
          <div className="mt-3 text-3xl font-bold text-white">{summary.assignedMembers}</div>
          <p className="mt-3 text-sm text-slate-300">People already mapped to at least one shared project.</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Pending Invites</div>
          <div className="mt-3 text-3xl font-bold text-white">{summary.pendingInvites}</div>
          <p className="mt-3 text-sm text-slate-300">Invitation records now live in the B2B worker path.</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Invites For You</div>
          <div className="mt-3 text-3xl font-bold text-white">{summary.incomingInvites}</div>
          <p className="mt-3 text-sm text-slate-300">Pending invitations tied to your current login email.</p>
        </div>
      </div>

      {data?.pending_invitations_for_me?.length ? (
        <div className="mt-6 rounded-[26px] border border-sky-400/20 bg-sky-400/10 p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-sky-200">Incoming Invitations</div>
          <h2 className="mt-3 text-2xl font-semibold text-white">You have organization invites waiting</h2>
          <div className="mt-5 space-y-3">
            {data.pending_invitations_for_me.map((invitation) => (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div>
                  <div className="text-sm font-semibold text-white">{invitation.organization.name}</div>
                  <div className="mt-1 text-sm text-slate-300">Role: {invitation.role}</div>
                  <div className="mt-1 text-xs text-slate-500">Invited {timeAgo(invitation.created_at)} to {invitation.email}</div>
                </div>
                <button
                  onClick={() => void acceptInvitation(invitation.id)}
                  className="rounded-2xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
                >
                  {acceptingInvitationId === invitation.id ? "Joining..." : "Accept Invite"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showInviteForm && data?.organization?.can_manage_members ? (
        <div className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Invite Flow</div>
          <h2 className="mt-3 text-2xl font-semibold text-white">Create a pending org invite</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Send one invite at a time, choose the starting organization role, then assign project access after the person joins.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_0.8fr_auto]">
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@company.com"
              className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as "admin" | "member" | "viewer")}
              className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={() => void createInvite()}
              disabled={submitting}
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Create Invite"}
            </button>
          </div>

          {inviteError ? <div className="mt-3 text-sm text-rose-300">{inviteError}</div> : null}
        </div>
      ) : null}

      {loading ? <div className="mt-6 py-20 text-center text-slate-400">Loading member access...</div> : null}
      {error && !loading ? (
        <div className="mt-6 rounded-[26px] border border-red-500/20 bg-red-500/10 p-6 text-center text-red-300">{error}</div>
      ) : null}
      {assignmentError && !loading ? (
        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">{assignmentError}</div>
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Org Members</div>
                <h2 className="mt-3 text-2xl font-semibold text-white">Real membership and project coverage</h2>
              </div>
              <div className="text-sm text-slate-400">{summary.projectCount} org project{summary.projectCount === 1 ? "" : "s"}</div>
            </div>

            <div className="mt-6 space-y-4">
              {data.members.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  No org members found yet.
                </div>
              ) : (
                data.members.map((member) => (
                  <div key={member.id} className="rounded-2xl border border-white/6 bg-slate-950/40 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-lg font-semibold text-white">{member.email || member.user_id}</div>
                        <div className="mt-1 font-mono text-xs text-slate-500">{member.user_id}</div>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${ROLE_STYLES[member.role]}`}>
                        {member.role}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Joined</div>
                        <div className="mt-2 text-sm font-medium text-white">{timeAgo(member.created_at)}</div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">{member.project_access.length} project assignment{member.project_access.length === 1 ? "" : "s"}</div>
                        {data.organization?.can_manage_members ? (
                          member.role === "owner" ? (
                            <div className="mt-3 text-xs text-slate-500">Owner role is locked here.</div>
                          ) : currentUserId === member.user_id ? (
                            <div className="mt-3 text-xs text-slate-500">Use a separate flow for changing your own org role.</div>
                          ) : (
                            <div className="mt-3 space-y-3">
                              <div className="grid gap-3 md:grid-cols-[0.9fr_auto]">
                                <select
                                  value={roleDrafts[member.user_id] || member.role}
                                  onChange={(event) =>
                                    setRoleDrafts((current) => ({
                                      ...current,
                                      [member.user_id]: event.target.value as "admin" | "member" | "viewer",
                                    }))
                                  }
                                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                                >
                                  <option value="member">Member</option>
                                  <option value="viewer">Viewer</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <button
                                  onClick={() => void updateOrganizationRole(member.user_id)}
                                  disabled={roleBusyUserId === member.user_id || (roleDrafts[member.user_id] || member.role) === member.role}
                                  className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {roleBusyUserId === member.user_id ? "Saving..." : "Update Role"}
                                </button>
                              </div>
                              <button
                                onClick={() => void removeOrganizationMember(member.user_id)}
                                disabled={removingUserId === member.user_id}
                                className="rounded-2xl border border-rose-400/20 px-4 py-3 text-sm text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {removingUserId === member.user_id ? "Removing..." : "Remove From Org"}
                              </button>
                            </div>
                          )
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Project Access</div>
                        {member.project_access.length === 0 ? (
                          <div className="mt-2 text-sm leading-6 text-slate-300">No project assignment yet.</div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {member.project_access.map((access) => (
                              <div key={`${member.id}-${access.project_id}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-200">
                                <div>
                                  <span className="font-medium text-white">{access.project_name || "Untitled project"}</span>{" "}
                                  <span className="text-slate-400">({access.role})</span>
                                </div>
                                {data.organization?.can_manage_members && access.role !== "owner" ? (
                                  <button
                                    onClick={() => void removeProjectAccess(access.project_id, member.user_id)}
                                    className="text-rose-300 transition hover:text-rose-200"
                                  >
                                    {assignmentBusyKey === `${member.user_id}:${access.project_id}:remove` ? "..." : "Remove"}
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {data.organization?.can_manage_members && data.projects.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Assign Project Access</div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[1.1fr_0.8fr_auto]">
                          <select
                            value={assignmentDrafts[member.user_id]?.projectId || data.projects[0].id}
                            onChange={(event) =>
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [member.user_id]: {
                                  projectId: event.target.value,
                                  role: current[member.user_id]?.role || "member",
                                },
                              }))
                            }
                            className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                          >
                            {data.projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name || "Untitled project"}
                              </option>
                            ))}
                          </select>
                          <select
                            value={assignmentDrafts[member.user_id]?.role || "member"}
                            onChange={(event) =>
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [member.user_id]: {
                                  projectId: current[member.user_id]?.projectId || data.projects[0].id,
                                  role: event.target.value as "admin" | "member" | "viewer",
                                },
                              }))
                            }
                            className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                          >
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            onClick={() => void assignProjectAccess(member.user_id)}
                            className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                          >
                            {assignmentBusyKey === `${member.user_id}:${assignmentDrafts[member.user_id]?.projectId}:assign` ? "Saving..." : "Assign"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Pending Invites</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">Invitation pipeline</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Pending invites are now tracked in the worker and can be revoked. Next up is acceptance and assignment from the dashboard itself.
            </p>

            <div className="mt-5 space-y-3">
              {data.invitations.filter((invitation) => invitation.status === "pending").length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  No pending invites right now.
                </div>
              ) : (
                data.invitations
                  .filter((invitation) => invitation.status === "pending")
                  .map((invitation) => (
                    <div key={invitation.id} className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{invitation.email}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{invitation.role}</div>
                        </div>
                        {data.organization?.can_manage_members ? (
                          <button
                            onClick={() => void revokeInvite(invitation.id)}
                            className="text-xs text-rose-300 transition hover:text-rose-200"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm text-slate-300">Created {timeAgo(invitation.created_at)}</div>
                    </div>
                  ))
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-white/6 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold text-white">Next API slice</div>
              <div className="mt-2 text-sm leading-6 text-slate-300">
                Accept invites, switch org context, and assign project roles directly from the dashboard using the new project member endpoints.
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
