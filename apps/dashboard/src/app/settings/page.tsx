"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";
import { setDashboardNotice } from "../../lib/dashboard-notice";
import { getOrganizationHeaders, ORG_EVENT_NAME, setSelectedOrganizationId } from "../../lib/org-context";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

interface OrganizationDetails {
  id: string;
  name: string;
  slug: string | null;
  kind: "personal" | "team";
  owner_user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  member_count: number;
  project_count: number;
  created_at: string;
  updated_at: string;
  can_archive: boolean;
  can_transfer_ownership: boolean;
}

interface OrganizationMemberCandidate {
  id: string;
  user_id: string;
  email: string | null;
  role: "owner" | "admin" | "member" | "viewer";
}

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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function SettingsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [dangerMessage, setDangerMessage] = useState<string | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetails | null>(null);
  const [memberCandidates, setMemberCandidates] = useState<OrganizationMemberCandidate[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [archiveConfirmationName, setArchiveConfirmationName] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("Dashboard auth is not configured.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
        setUserEmail(data.session.user?.email ?? null);
        setCurrentUserId(data.session.user?.id ?? null);
      } else {
        setError("Not logged in. Sign in at vaultproof.dev first.");
        setLoading(false);
      }
    }).catch(() => {
      setError("Unable to check login status. Try refreshing.");
      setLoading(false);
    });
  }, []);

  const fetchOrganization = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setDangerError(null);

    try {
      const headers = getOrganizationHeaders(token);
      const [organizationResponse, membersResponse] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/init/orgs/current`, { headers }),
        fetch(`${BACKEND_URL}/api/v1/init/members`, { headers }),
      ]);

      const payload = await organizationResponse.json().catch(() => null);
      if (!organizationResponse.ok) {
        setError(payload?.error || "Failed to load organization settings.");
        return;
      }

      const org = payload?.organization as OrganizationDetails | undefined;
      if (!org) {
        setError("Organization not found.");
        return;
      }

      setOrganization(org);
      setName(org.name);
      setSlug(org.slug || "");
      setArchiveConfirmationName("");

      const membersPayload = await membersResponse.json().catch(() => null);
      const candidates = (membersPayload?.members || []) as OrganizationMemberCandidate[];
      setMemberCandidates(candidates);
      const firstCandidate = candidates.find((member) => member.user_id !== org.owner_user_id);
      setTransferTargetUserId((current) => current || firstCandidate?.user_id || "");
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void fetchOrganization();
    }
  }, [token, fetchOrganization]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void fetchOrganization();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [fetchOrganization, token]);

  async function saveOrganization() {
    if (!token || !organization) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs/current`, {
        method: "PUT",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, slug: slug || null }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to update organization.");
        return;
      }

      const updated = payload?.organization as OrganizationDetails | undefined;
      if (updated) {
        setOrganization(updated);
        setName(updated.name);
        setSlug(updated.slug || "");
      }
      setSaveMessage("Organization settings updated.");
    } catch {
      setError("Network error while updating organization.");
    } finally {
      setSaving(false);
    }
  }

  async function transferOwnership() {
    if (!token || !organization || !transferTargetUserId) return;
    setDangerBusy(true);
    setDangerError(null);
    setDangerMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs/current/transfer-ownership`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_user_id: transferTargetUserId }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setDangerError(payload?.error || "Failed to transfer ownership.");
        return;
      }

      setSelectedOrganizationId(organization.id);
      setDangerMessage("Organization ownership transferred. Your role is now admin.");
      await fetchOrganization();
    } catch {
      setDangerError("Network error while transferring ownership.");
    } finally {
      setDangerBusy(false);
    }
  }

  async function archiveOrganization() {
    if (!token || !organization) return;
    setDangerBusy(true);
    setDangerError(null);
    setDangerMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs/current/archive`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation_name: archiveConfirmationName }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setDangerError(payload?.error || "Failed to archive organization.");
        return;
      }

      setDashboardNotice({
        type: "info",
        message: `Archived ${organization.name}. VaultProof switched you back to your next available organization.`,
      });
      setSelectedOrganizationId(null);
      router.push("/projects");
    } catch {
      setDangerError("Network error while archiving organization.");
    } finally {
      setDangerBusy(false);
    }
  }

  const canEdit = organization?.role === "owner" || organization?.role === "admin";
  const canTransferOwnership = organization?.can_transfer_ownership && currentUserId === organization.owner_user_id;
  const canArchive = organization?.can_archive && currentUserId === organization.owner_user_id;
  const transferCandidates = memberCandidates.filter((member) => member.user_id !== organization?.owner_user_id);

  return (
    <AppShell
      eyebrow="Organization Settings"
      title="Settings"
      description="Manage the currently selected organization. This is the first admin surface for team org identity, basic metadata, and ownership context."
      actions={
        userEmail ? (
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-200">
              {userEmail[0].toUpperCase()}
            </div>
            <div className="text-sm text-slate-300">{userEmail}</div>
          </div>
        ) : null
      }
    >
      {loading ? <div className="py-20 text-center text-slate-400">Loading organization settings...</div> : null}
      {error && !loading ? (
        <div className="rounded-[26px] border border-red-500/20 bg-red-500/10 p-6 text-center text-red-300">{error}</div>
      ) : null}

      {!loading && !error && organization ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Active Organization</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">Basic settings</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Team orgs can now be renamed and assigned a cleaner slug. This surface also starts to carry the higher-risk ownership and archive controls that B2B admins expect.
            </p>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Organization Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canEdit}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus:border-emerald-400/35"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  disabled={!canEdit}
                  placeholder="team-slug"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus:border-emerald-400/35"
                />
              </div>
            </div>

            {saveMessage ? <div className="mt-4 text-sm text-emerald-300">{saveMessage}</div> : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => void saveOrganization()}
                disabled={!canEdit || saving}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Organization"}
              </button>
              {!canEdit ? <div className="self-center text-sm text-slate-400">Owner or admin role required to edit organization settings.</div> : null}
            </div>
          </section>

          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Overview</div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Organization Type</div>
                <div className="mt-2 text-sm text-slate-300">{organization.kind}</div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Your Role</div>
                <div className="mt-2 text-sm text-slate-300">{organization.role}</div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Members</div>
                <div className="mt-2 text-sm text-slate-300">{organization.member_count}</div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Projects</div>
                <div className="mt-2 text-sm text-slate-300">{organization.project_count}</div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Created</div>
                <div className="mt-2 text-sm text-slate-300">{timeAgo(organization.created_at)}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(organization.created_at)}</div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Last Updated</div>
                <div className="mt-2 text-sm text-slate-300">{timeAgo(organization.updated_at)}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(organization.updated_at)}</div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-amber-200">Sensitive Controls</div>
              <div className="mt-3 space-y-5">
                <div>
                  <div className="text-sm font-semibold text-white">Transfer Ownership</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">
                    Move organization ownership to another existing member. This is owner-only and automatically changes your role to admin.
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/6 bg-white/[0.03] p-3 text-xs leading-6 text-slate-400">
                    Ownership transfer keeps the same projects, members, policies, and audit history in place. It only changes who controls future owner-only actions.
                  </div>
                  {canTransferOwnership ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                      <select
                        value={transferTargetUserId}
                        onChange={(event) => setTransferTargetUserId(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/35"
                      >
                        {transferCandidates.length === 0 ? (
                          <option value="">No eligible members yet</option>
                        ) : (
                          transferCandidates.map((member) => (
                            <option key={member.user_id} value={member.user_id}>
                              {(member.email || member.user_id)} · {member.role}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        onClick={() => void transferOwnership()}
                        disabled={dangerBusy || !transferTargetUserId}
                        className="rounded-2xl border border-amber-300/25 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {dangerBusy ? "Updating..." : "Transfer Ownership"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-slate-500">Only the current owner of a team organization can transfer ownership.</div>
                  )}
                </div>

                <div className="border-t border-white/10 pt-5">
                  <div className="text-sm font-semibold text-white">Archive Organization</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">
                    Archive removes the organization from the active workspace flow. This is intended for shutdown or consolidation, not day-to-day cleanup.
                  </div>
                  <div className="mt-3 rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-amber-200">What Archive Does</div>
                    <div className="mt-3 grid gap-3 text-sm text-slate-300">
                      <div>Projects, members, and audit history are preserved.</div>
                      <div>The organization drops out of active switching and day-to-day dashboard flows.</div>
                      <div>Only the team-org owner can restore it later from the organization sidebar.</div>
                    </div>
                  </div>
                  {canArchive ? (
                    <div className="mt-4 space-y-3">
                      <input
                        type="text"
                        value={archiveConfirmationName}
                        onChange={(event) => setArchiveConfirmationName(event.target.value)}
                        placeholder={organization.name}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-rose-300/35"
                      />
                      <button
                        onClick={() => void archiveOrganization()}
                        disabled={dangerBusy || archiveConfirmationName.trim() !== organization.name}
                        className="rounded-2xl border border-rose-400/20 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {dangerBusy ? "Archiving..." : "Archive Organization"}
                      </button>
                      <div className="text-xs text-slate-500">
                        Type the exact organization name to enable archive. This does not delete the org, but it does pause active use until the owner restores it.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-slate-500">Only the current owner of a team organization can archive it.</div>
                  )}
                </div>

                {dangerMessage ? <div className="text-sm text-emerald-300">{dangerMessage}</div> : null}
                {dangerError ? <div className="text-sm text-rose-300">{dangerError}</div> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
