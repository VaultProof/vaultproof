"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";
import { getOrganizationHeaders, ORG_EVENT_NAME } from "../../lib/org-context";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

interface ProjectSummary {
  id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  created_at: string;
  revoked_at: string | null;
  project_role: "owner" | "admin" | "member" | "viewer";
  access_via: "project" | "organization";
}

interface OverviewStats {
  totalProjects: number;
  totalKeys: number;
  providers: string[];
  providerCount: number;
  activeApps: number;
  totalCalls: number;
  errorCalls: number;
  deniedCalls: number;
  errorRate: number;
  healthWindowDays: number;
  projectHealth: Array<{
    project_id: string;
    name: string | null;
    vp_proj_id: string;
    calls: number;
    errors: number;
    denied: number;
    lastActivity: string | null;
  }>;
  alerts: Array<{
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    project_id: string | null;
    project_name: string | null;
  }>;
  pilotReview: {
    status: "setup" | "healthy" | "watch" | "action_needed";
    headline: string;
    recommendation: string;
    evaluationWindowDays: number;
    projectsWithTraffic: number;
    projectsNeedingAttention: number;
    topProject: {
      project_id: string;
      name: string | null;
      vp_proj_id: string;
      calls: number;
      denied: number;
      errors: number;
    } | null;
  };
  recentActivity: Array<{
    action: string;
    timestamp: string;
    description: string;
    metadata?: {
      status_code?: number;
      latency_ms?: number | null;
    };
  }>;
}

interface ActiveOrganization {
  id: string;
  name: string;
  kind: "personal" | "team";
  current_role: "owner" | "admin" | "member" | "viewer";
}

const ROLE_STYLES: Record<ProjectSummary["project_role"], string> = {
  owner: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  admin: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  member: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  viewer: "border-white/15 bg-white/[0.06] text-slate-200",
};

const PILOT_STATUS_STYLES: Record<OverviewStats["pilotReview"]["status"], string> = {
  setup: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  healthy: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  watch: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  action_needed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
};

const ALERT_STYLES: Record<OverviewStats["alerts"][number]["severity"], string> = {
  critical: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  info: "border-sky-300/20 bg-sky-300/10 text-sky-100",
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

function formatErrorRate(rate: number): string {
  if (!Number.isFinite(rate)) return "0%";
  if (rate === 0) return "0%";
  if (rate < 0.1) return "<0.1%";
  return `${rate.toFixed(1)}%`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [organization, setOrganization] = useState<ActiveOrganization | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectOrigins, setProjectOrigins] = useState("");
  const [projectStrictOrigin, setProjectStrictOrigin] = useState(false);
  const [editingPolicyProjectId, setEditingPolicyProjectId] = useState<string | null>(null);
  const [policyOrigins, setPolicyOrigins] = useState("");
  const [policyStrictOrigin, setPolicyStrictOrigin] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [confirmingRevokeProjectId, setConfirmingRevokeProjectId] = useState<string | null>(null);
  const [revokingProjectId, setRevokingProjectId] = useState<string | null>(null);
  const [briefMessage, setBriefMessage] = useState<string | null>(null);

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
      const headers = getOrganizationHeaders(token);
      const [projectsRes, overviewRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/init/projects`, { headers }),
        fetch(`${BACKEND_URL}/api/v1/init/projects/stats/overview`, { headers }),
      ]);

      if (!projectsRes.ok || !overviewRes.ok) {
        setError("Failed to load project data. Try refreshing.");
        return;
      }

      const projectsData = await projectsRes.json();
      const overviewData = await overviewRes.json();

      setOrganization(projectsData.organization ?? null);
      setProjects(projectsData.projects ?? []);
      setOverview(overviewData);
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

  async function createProject() {
    if (!token) return;
    setCreatingProject(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName || null,
          allowed_origins: projectOrigins || null,
          strict_origin: projectStrictOrigin,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to create project.");
        return;
      }

      const createdProjectId = payload?.project?.id || payload?.id || null;
      setProjectName("");
      setProjectOrigins("");
      setProjectStrictOrigin(false);
      setShowCreateForm(false);
      if (createdProjectId) {
        router.push(`/keys?project=${createdProjectId}&onboarding=1`);
        return;
      }
      await fetchData();
    } catch {
      setError("Network error while creating project.");
    } finally {
      setCreatingProject(false);
    }
  }

  function beginPolicyEdit(project: ProjectSummary) {
    setEditingPolicyProjectId(project.id);
    setPolicyOrigins(project.allowed_origins || "");
    setPolicyStrictOrigin(project.strict_origin);
  }

  function cancelPolicyEdit() {
    setEditingPolicyProjectId(null);
    setPolicyOrigins("");
    setPolicyStrictOrigin(false);
  }

  async function saveProjectPolicy(projectId: string) {
    if (!token) return;
    setSavingPolicy(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${projectId}`, {
        method: "PUT",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          allowed_origins: policyOrigins || null,
          strict_origin: policyStrictOrigin,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to update project policy.");
        return;
      }

      cancelPolicyEdit();
      await fetchData();
    } catch {
      setError("Network error while updating project policy.");
    } finally {
      setSavingPolicy(false);
    }
  }

  async function revokeProject(projectId: string) {
    if (!token) return;
    setRevokingProjectId(projectId);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${projectId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to disable project.");
        return;
      }

      if (editingPolicyProjectId === projectId) {
        cancelPolicyEdit();
      }
      setConfirmingRevokeProjectId(null);
      await fetchData();
    } catch {
      setError("Network error while disabling project.");
    } finally {
      setRevokingProjectId(null);
    }
  }

  const summaryCards = useMemo(() => {
    const roleSummary = new Set(projects.map((project) => project.project_role));
    return [
      {
        label: "Active Org",
        value: organization?.name || "No org",
        detail: organization ? `${organization.kind} org · ${organization.current_role}` : "Select or create an organization to continue.",
      },
      {
        label: "Accessible Projects",
        value: String(projects.length),
        detail: `${roleSummary.size || 1} active role tier${roleSummary.size === 1 ? "" : "s"} across your projects.`,
      },
      {
        label: "Protected Providers",
        value: String(overview?.providerCount ?? 0),
        detail: overview?.providers?.length
          ? overview.providers.join(", ")
          : "No provider traffic recorded yet.",
      },
      {
        label: "Proxy Calls",
        value: formatCount(overview?.totalCalls ?? 0),
        detail: `Current observed error rate: ${formatErrorRate(overview?.errorRate ?? 0)}.`,
      },
      {
        label: "Denied Requests",
        value: formatCount(overview?.deniedCalls ?? 0),
        detail: `${formatCount(overview?.errorCalls ?? 0)} error responses observed across accessible projects.`,
      },
    ];
  }, [organization, overview, projects]);

  const projectHealthMap = useMemo(() => {
    return new Map((overview?.projectHealth ?? []).map((item) => [item.project_id, item]));
  }, [overview]);

  const attentionProjects = useMemo(() => {
    return (overview?.projectHealth ?? []).filter((item) => item.denied > 0 || item.errors > 0).slice(0, 3);
  }, [overview]);

  const healthSnapshot = useMemo(() => {
    return (overview?.projectHealth ?? []).reduce(
      (totals, item) => {
        totals.calls += item.calls;
        totals.denied += item.denied;
        totals.errors += item.errors;
        return totals;
      },
      { calls: 0, denied: 0, errors: 0 },
    );
  }, [overview]);

  const pilotReview = useMemo(() => overview?.pilotReview ?? null, [overview]);
  const alerts = useMemo(() => overview?.alerts ?? [], [overview]);
  const pilotReviewBrief = useMemo(() => {
    const lines = [
      `VaultProof Pilot Review`,
      `Organization: ${organization?.name || "No active organization"}`,
      `Status: ${pilotReview ? titleCase(pilotReview.status) : "Unknown"}`,
      `Window: ${pilotReview?.evaluationWindowDays ?? (overview?.healthWindowDays ?? 7)} days`,
      `Projects with traffic: ${pilotReview?.projectsWithTraffic ?? 0}`,
      `Projects needing attention: ${pilotReview?.projectsNeedingAttention ?? 0}`,
      `Providers connected: ${overview?.providers?.length ? overview.providers.join(", ") : "None"}`,
      `Total calls: ${formatCount(overview?.totalCalls ?? 0)}`,
      `Denied requests: ${formatCount(overview?.deniedCalls ?? 0)}`,
      `Errors: ${formatCount(overview?.errorCalls ?? 0)}`,
      `Error rate: ${formatErrorRate(overview?.errorRate ?? 0)}`,
      "",
      `Headline: ${pilotReview?.headline || "No pilot headline yet"}`,
      `Recommendation: ${pilotReview?.recommendation || "No recommendation yet"}`,
    ];

    if (pilotReview?.topProject) {
      lines.push(
        "",
        `Top project: ${pilotReview.topProject.name || pilotReview.topProject.vp_proj_id}`,
        `Top project calls: ${formatCount(pilotReview.topProject.calls)}`,
        `Top project denied: ${formatCount(pilotReview.topProject.denied)}`,
        `Top project errors: ${formatCount(pilotReview.topProject.errors)}`,
      );
    }

    if (alerts.length > 0) {
      lines.push("", "Active alerts:");
      for (const alert of alerts) {
        lines.push(`- [${titleCase(alert.severity)}] ${alert.title}: ${alert.detail}`);
      }
    }

    return lines.join("\n");
  }, [alerts, organization, overview, pilotReview]);

  async function copyPilotReviewBrief() {
    try {
      await navigator.clipboard.writeText(pilotReviewBrief);
      setBriefMessage("Pilot review brief copied.");
      window.setTimeout(() => setBriefMessage(null), 2500);
    } catch {
      setBriefMessage("Clipboard copy failed. You can still copy the brief from the text box below.");
      window.setTimeout(() => setBriefMessage(null), 3500);
    }
  }

  return (
    <AppShell
      eyebrow="Project inventory"
      title="Projects"
      description="Review project health, provider slot posture, policy status, traffic activity, and quick paths into enterprise controls."
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
          <button
            onClick={() => setShowCreateForm((current) => !current)}
            className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            {showCreateForm ? "Close" : "New project"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-white/8 bg-white/[0.04] p-5 shadow-[0_12px_40px_rgba(2,6,23,0.25)]"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{card.label}</div>
            <div className="mt-3 text-3xl font-bold text-white">{card.value}</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{card.detail}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">Loading shared project access...</div>
      ) : null}

      {error && !loading ? (
        <div className="mt-6 rounded-[26px] border border-red-500/20 bg-red-500/10 p-6 text-center">
          <div className="text-red-300">{error}</div>
          {token ? (
            <button
              onClick={() => void fetchData()}
              className="mt-3 text-sm text-red-200 underline decoration-red-300/40 underline-offset-4"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {showCreateForm && !loading ? (
        <div className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Project Setup</div>
          <h2 className="mt-3 text-2xl font-semibold text-white">Create the first project in this organization</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Start with one app or environment, connect one provider, and then invite teammates into the project instead of sharing raw provider keys.
          </p>

          <div className="mt-5 grid gap-4">
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Production API Gateway"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
            />
            <input
              type="text"
              value={projectOrigins}
              onChange={(event) => setProjectOrigins(event.target.value)}
              placeholder="https://app.example.com, https://admin.example.com"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
            />
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={projectStrictOrigin}
                onChange={(event) => setProjectStrictOrigin(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950/70"
              />
              Enforce strict origin lock for the allowed origins above
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => void createProject()}
              disabled={creatingProject}
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingProject ? "Creating..." : "Create Project"}
            </button>
            <div className="self-center text-sm text-slate-400">
              Recommended first step: create one production or staging project, then connect one provider.
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Accessible Projects</div>
                <h2 className="mt-3 text-2xl font-semibold text-white">Shared project access is now the control point.</h2>
              </div>
              <div className="text-sm text-slate-400">{projects.length} visible project{projects.length === 1 ? "" : "s"}</div>
            </div>

            {projects.length === 0 ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-6 text-sm text-slate-300">
                  No projects are visible yet for <span className="font-medium text-white">{organization?.name || "this organization"}</span>. Create the first project to start routing provider traffic through VaultProof for this team.
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="text-sm font-semibold text-white">1. Create a project</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">Define the first app or environment this org wants to protect.</div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="text-sm font-semibold text-white">2. Add a provider key</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">Connect OpenAI, Stripe, Anthropic, or another provider through VaultProof.</div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="text-sm font-semibold text-white">3. Invite teammates</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">Grant shared project access without ever exposing raw provider secrets.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {projects.map((project) => {
                  const projectHealth = projectHealthMap.get(project.id);
                  return (
                    <div key={project.id} className="rounded-2xl border border-white/6 bg-slate-950/40 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-lg font-semibold text-white">{project.name || "Untitled project"}</div>
                        <div className="mt-1 font-mono text-xs text-slate-500">{project.vp_proj_id}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${ROLE_STYLES[project.project_role]}`}>
                          {project.project_role}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
                          via {project.access_via}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Origin Policy</div>
                        <div className="mt-2 text-sm font-medium text-white">
                          {project.strict_origin ? "Strict origin lock enabled" : "Origin lock not enforced"}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">
                          {project.allowed_origins || "No allowlist saved yet."}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Ownership</div>
                        <div className="mt-2 text-sm font-medium text-white">
                          {project.organization_id ? "Organization-scoped" : "Legacy single-user scope"}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">
                          Access is enforced by project membership and org role, not raw key sharing.
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Created</div>
                        <div className="mt-2 text-sm font-medium text-white">{timeAgo(project.created_at)}</div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">
                          Project record: {project.id}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/6 bg-slate-950/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Health ({overview?.healthWindowDays ?? 7}d)</div>
                        <div className="mt-2 text-sm font-medium text-white">
                          {projectHealth?.calls ? `${formatCount(projectHealth.calls)} calls tracked` : "No recent traffic"}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">
                          {projectHealth?.denied || projectHealth?.errors
                            ? `${formatCount(projectHealth?.denied ?? 0)} denied · ${formatCount(projectHealth?.errors ?? 0)} errors`
                            : "No denied or error responses in the current health window."}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Last activity: {projectHealth?.lastActivity ? timeAgo(projectHealth.lastActivity) : "No recent requests"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {project.project_role === "owner" || project.project_role === "admin" ? (
                        <>
                          <button
                            onClick={() => beginPolicyEdit(project)}
                            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04]"
                          >
                            Edit Policy
                          </button>
                          <button
                            onClick={() => setConfirmingRevokeProjectId(project.id)}
                            className="rounded-xl border border-rose-400/20 px-4 py-2 text-sm text-rose-200 transition hover:bg-rose-500/10"
                          >
                            Disable Project
                          </button>
                        </>
                      ) : (
                        <div className="text-sm text-slate-500">
                          Policy editing requires admin access.
                        </div>
                      )}
                    </div>

                    {editingPolicyProjectId === project.id ? (
                      <div className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Policy Editor</div>
                        <h3 className="mt-3 text-lg font-semibold text-white">Update origin controls for {project.name || project.vp_proj_id}</h3>
                        <div className="mt-4 grid gap-4">
                          <input
                            type="text"
                            value={policyOrigins}
                            onChange={(event) => setPolicyOrigins(event.target.value)}
                            placeholder="https://app.example.com, https://admin.example.com"
                            className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                          />
                          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={policyStrictOrigin}
                              onChange={(event) => setPolicyStrictOrigin(event.target.checked)}
                              className="h-4 w-4 rounded border-white/20 bg-slate-950/70"
                            />
                            Enforce strict origin lock for the allowed origins above
                          </label>
                        </div>
                        <div className="mt-5 flex flex-wrap gap-3">
                          <button
                            onClick={() => void saveProjectPolicy(project.id)}
                            disabled={savingPolicy}
                            className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingPolicy ? "Saving..." : "Save Policy"}
                          </button>
                          <button
                            onClick={cancelPolicyEdit}
                            className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-slate-300 transition hover:bg-white/[0.04]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {confirmingRevokeProjectId === project.id ? (
                      <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-rose-200">Fast Shutdown</div>
                        <h3 className="mt-3 text-lg font-semibold text-white">Disable {project.name || project.vp_proj_id}?</h3>
                        <p className="mt-3 text-sm leading-7 text-slate-300">
                          This soft-revokes the project so it no longer appears in the active team surface. Use this when you need to stop traffic quickly while investigating abuse, leakage, or a bad rollout.
                        </p>
                        <div className="mt-5 flex flex-wrap gap-3">
                          <button
                            onClick={() => void revokeProject(project.id)}
                            disabled={revokingProjectId === project.id}
                            className="rounded-2xl bg-rose-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {revokingProjectId === project.id ? "Disabling..." : "Confirm Disable"}
                          </button>
                          <button
                            onClick={() => setConfirmingRevokeProjectId(null)}
                            className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-slate-300 transition hover:bg-white/[0.04]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Health & Activity</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">Usage signals we can already expose</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Runtime request logs already exist, so the first governance pass can start from actual traffic instead of mock enterprise analytics.
            </p>

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Pilot review summary</div>
                  {pilotReview ? (
                    <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${PILOT_STATUS_STYLES[pilotReview.status]}`}>
                      {pilotReview.status.replace("_", " ")}
                    </div>
                  ) : null}
                </div>
                {pilotReview ? (
                  <>
                    <div className="mt-3 text-lg font-semibold text-white">{pilotReview.headline}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">{pilotReview.recommendation}</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                      <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Observed Projects</div>
                        <div className="mt-2 text-xl font-semibold text-white">{pilotReview.projectsWithTraffic}</div>
                      </div>
                      <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Need Attention</div>
                        <div className="mt-2 text-xl font-semibold text-white">{pilotReview.projectsNeedingAttention}</div>
                      </div>
                      <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Review Window</div>
                        <div className="mt-2 text-xl font-semibold text-white">{pilotReview.evaluationWindowDays}d</div>
                      </div>
                    </div>
                    {pilotReview.topProject ? (
                      <div className="mt-4 rounded-xl border border-white/6 bg-white/[0.03] p-3 text-sm text-slate-300">
                        Top project: <span className="font-medium text-white">{pilotReview.topProject.name || pilotReview.topProject.vp_proj_id}</span>
                        {" · "}
                        {formatCount(pilotReview.topProject.calls)} calls
                        {" · "}
                        {formatCount(pilotReview.topProject.denied)} denied
                        {" · "}
                        {formatCount(pilotReview.topProject.errors)} errors
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-400">Pilot review summary will appear once traffic and project health data exist.</div>
                )}
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Exportable review brief</div>
                  <button
                    onClick={() => void copyPilotReviewBrief()}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.04]"
                  >
                    Copy Brief
                  </button>
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  This is a ready-to-share snapshot for internal updates, pilot reviews, or customer follow-up without rewriting the current health picture by hand.
                </div>
                {briefMessage ? <div className="mt-3 text-sm text-emerald-300">{briefMessage}</div> : null}
                <textarea
                  readOnly
                  value={pilotReviewBrief}
                  rows={Math.min(18, Math.max(10, pilotReviewBrief.split("\n").length))}
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-6 text-slate-200 outline-none"
                />
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Current health snapshot</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Last {overview?.healthWindowDays ?? 7} days</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Calls</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatCount(healthSnapshot.calls)}</div>
                  </div>
                  <div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-amber-200">Denied</div>
                    <div className="mt-2 text-xl font-semibold text-amber-100">{formatCount(healthSnapshot.denied)}</div>
                  </div>
                  <div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-rose-200">Errors</div>
                    <div className="mt-2 text-xl font-semibold text-rose-100">{formatCount(healthSnapshot.errors)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Alerts</div>
                <div className="mt-3 space-y-3">
                  {alerts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No alert conditions are active right now.
                    </div>
                  ) : (
                    alerts.map((alert) => (
                      <div key={alert.id} className={`rounded-xl border p-3 ${ALERT_STYLES[alert.severity]}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{alert.title}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">{alert.severity}</div>
                        </div>
                        <div className="mt-2 text-sm leading-6">{alert.detail}</div>
                        {alert.project_name ? (
                          <div className="mt-2 text-xs text-white/75">Project: {alert.project_name}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Projects needing attention</div>
                <div className="mt-3 space-y-3">
                  {attentionProjects.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No recent denied or error-heavy projects in the current health window.
                    </div>
                  ) : (
                    attentionProjects.map((item) => (
                      <div key={item.project_id} className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-white">{item.name || item.vp_proj_id}</div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            {item.lastActivity ? timeAgo(item.lastActivity) : "No activity"}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                          <span>{formatCount(item.calls)} calls</span>
                          <span>{formatCount(item.denied)} denied</span>
                          <span>{formatCount(item.errors)} errors</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {(overview?.recentActivity ?? []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  No proxy activity yet. Once requests flow through VaultProof, this becomes the first enterprise audit surface.
                </div>
              ) : (
                overview?.recentActivity.map((item) => (
                  <div key={`${item.timestamp}-${item.description}`} className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{item.description}</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{timeAgo(item.timestamp)}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>Status: {item.metadata?.status_code ?? "n/a"}</span>
                      <span>Latency: {item.metadata?.latency_ms ?? "n/a"}ms</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-white/6 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold text-white">Next up</div>
              <div className="mt-2 text-sm leading-6 text-slate-300">
                The next useful layer here is delivering these alerts outside the dashboard with export and notification workflows for pilots and enterprise reviews.
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
