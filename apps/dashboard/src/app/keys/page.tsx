"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";
import { getOrganizationHeaders, ORG_EVENT_NAME } from "../../lib/org-context";
import { serializeShare, splitString } from "../../lib/shamir";

export const dynamic = "force-dynamic";

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
  project_role: "owner" | "admin" | "member" | "viewer";
}

interface ProjectKey {
  id: string;
  provider: string;
  slug: string | null;
  env_var: string | null;
  upstream_base_url: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ProviderPreset {
  provider: string;
  label: string;
  upstream_base_url: string;
  auth_header_name: string;
  auth_header_template: string;
  extra_headers?: Record<string, string> | null;
  placeholder: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: "openai",
    label: "OpenAI",
    upstream_base_url: "https://api.openai.com",
    auth_header_name: "Authorization",
    auth_header_template: "Bearer {key}",
    placeholder: "sk-proj-...",
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    upstream_base_url: "https://api.anthropic.com",
    auth_header_name: "x-api-key",
    auth_header_template: "{key}",
    extra_headers: { "anthropic-version": "2023-06-01" },
    placeholder: "sk-ant-...",
  },
  {
    provider: "stripe",
    label: "Stripe",
    upstream_base_url: "https://api.stripe.com",
    auth_header_name: "Authorization",
    auth_header_template: "Bearer {key}",
    placeholder: "sk_live_...",
  },
  {
    provider: "google",
    label: "Google AI",
    upstream_base_url: "https://generativelanguage.googleapis.com",
    auth_header_name: "x-goog-api-key",
    auth_header_template: "{key}",
    placeholder: "AIza...",
  },
  {
    provider: "together",
    label: "Together.ai",
    upstream_base_url: "https://api.together.xyz",
    auth_header_name: "Authorization",
    auth_header_template: "Bearer {key}",
    placeholder: "together-...",
  },
];

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-green-500/10 text-green-400 border-green-500/20",
  anthropic: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  stripe: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  google: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  together: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function KeysDashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboardingProjectId = searchParams.get("project");
  const onboarding = searchParams.get("onboarding") === "1";
  const setupComplete = searchParams.get("setup") === "1";

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(onboardingProjectId);
  const [keys, setKeys] = useState<ProjectKey[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddKey, setShowAddKey] = useState(onboarding);
  const [provider, setProvider] = useState(PROVIDER_PRESETS[0].provider);
  const [label, setLabel] = useState("");
  const [rawKey, setRawKey] = useState("");

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

  const selectedPreset = useMemo(() => {
    return PROVIDER_PRESETS.find((item) => item.provider === provider) || PROVIDER_PRESETS[0];
  }, [provider]);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const fetchProjects = useCallback(async () => {
    if (!token) return [] as ProjectSummary[];
    const response = await fetch(`${BACKEND_URL}/api/v1/init/projects`, {
      headers: getOrganizationHeaders(token),
    });
    if (!response.ok) {
      throw new Error("Failed to load projects.");
    }
    const payload = await response.json();
    return (payload.projects || []) as ProjectSummary[];
  }, [token]);

  const fetchKeys = useCallback(async (projectId: string | null) => {
    if (!token || !projectId) {
      setKeys([]);
      setLoading(false);
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${projectId}/keys`, {
      headers: getOrganizationHeaders(token),
    });
    if (!response.ok) {
      throw new Error("Failed to load project keys.");
    }
    const payload = await response.json();
    setKeys(payload.keys || []);
  }, [token]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const projectRows = await fetchProjects();
      setProjects(projectRows);

      const preferredProjectId = onboardingProjectId && projectRows.some((project) => project.id === onboardingProjectId)
        ? onboardingProjectId
        : selectedProjectId && projectRows.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : projectRows[0]?.id || null;

      setSelectedProjectId(preferredProjectId);
      await fetchKeys(preferredProjectId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load key data.");
    } finally {
      setLoading(false);
    }
  }, [fetchKeys, fetchProjects, onboardingProjectId, selectedProjectId, token]);

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

  async function handleProjectChange(projectId: string) {
    setSelectedProjectId(projectId);
    setLoading(true);
    setError(null);
    try {
      await fetchKeys(projectId);
      const next = new URLSearchParams(searchParams.toString());
      next.set("project", projectId);
      next.delete("onboarding");
      next.delete("setup");
      router.replace(`/keys?${next.toString()}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project keys.");
    } finally {
      setLoading(false);
    }
  }

  async function storeKey() {
    if (!token || !selectedProjectId) return;
    if (!rawKey.trim()) {
      setError("API key is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const shares = splitString(rawKey.trim(), 2, 2);
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${selectedProjectId}/keys`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: selectedPreset.provider,
          slug: label.trim() || selectedPreset.provider,
          share1: serializeShare(shares[0]),
          share2: serializeShare(shares[1]),
          upstream_base_url: selectedPreset.upstream_base_url,
          auth_header_name: selectedPreset.auth_header_name,
          auth_header_template: selectedPreset.auth_header_template,
          extra_headers: selectedPreset.extra_headers || null,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to store provider key.");
        return;
      }

      setRawKey("");
      setLabel("");
      setShowAddKey(false);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("onboarding");
      next.set("setup", "1");
      router.replace(`/keys?${next.toString()}`);
      await fetchKeys(selectedProjectId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to store provider key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (!token || !selectedProjectId) return;
    setError(null);
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/projects/${selectedProjectId}/keys/${keyId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to revoke key.");
        return;
      }
      await fetchKeys(selectedProjectId);
    } catch {
      setError("Network error while revoking key.");
    }
  }

  return (
    <AppShell
      eyebrow="Provider slots"
      title="Provider slots"
      description="View active providers, emergency revoke slots, rotation checklists, and Cloud KMS custody notes for each project."
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
            onClick={() => setShowAddKey((current) => !current)}
            className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            {showAddKey ? "Close" : "Add provider slot"}
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Project</label>
            <select
              value={selectedProjectId || ""}
              onChange={(event) => void handleProjectChange(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || project.vp_proj_id}
                </option>
              ))}
            </select>
          </div>
          <div className="self-end text-sm text-slate-400">
            {selectedProjectId ? "Provider slots are project-scoped and never shared as raw provider secrets." : "A project is required before provider slots can be added."}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">Loading project keys...</div>
        ) : null}

        {error && !loading ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center text-red-300">
            <div>{error}</div>
            {token ? (
              <button onClick={() => void fetchData()} className="mt-3 text-sm text-red-200 underline decoration-red-300/40 underline-offset-4">
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading && !error && onboarding && selectedProjectId ? (
          <div className="mb-6 rounded-[26px] border border-emerald-400/20 bg-emerald-400/10 p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-200">Next Step</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">Your project is ready. Connect the first provider now.</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              This is the fastest onboarding path: create the org, create the first project, then store one provider key so traffic can start flowing through VaultProof immediately.
            </p>
          </div>
        ) : null}

        {!loading && !error && setupComplete && selectedProject ? (
          <div className="mb-6 rounded-[26px] border border-sky-400/20 bg-sky-400/10 p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-200">Provider Connected</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">The first provider is now protected for {selectedProject.name || selectedProject.vp_proj_id}.</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              VaultProof can now proxy this project without exposing the raw upstream secret. The best next step is to invite the team members who need access, then confirm the project&apos;s origin policy is locked the way you want.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Team Access</div>
                <div className="mt-2 text-sm text-slate-200">Invite teammates and assign project roles without sharing provider credentials.</div>
                <button
                  onClick={() => router.push("/members")}
                  className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04]"
                >
                  Open Members
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Project Policy</div>
                <div className="mt-2 text-sm text-slate-200">
                  {selectedProject.strict_origin
                    ? "Strict origin lock is enabled for this project."
                    : "Strict origin lock is not enabled yet for this project."}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {selectedProject.allowed_origins
                    ? `Allowed origins: ${selectedProject.allowed_origins}`
                    : "No allowed origins set yet."}
                </div>
                <button
                  onClick={() => router.push("/projects")}
                  className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04]"
                >
                  Review Project
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !error && showAddKey ? (
          <div className="mb-8 rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <h2 className="text-lg font-bold text-white">Store a Provider Key</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.provider} value={preset.provider}>{preset.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Label / Slug</label>
                <input
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={`${selectedPreset.provider}-production`}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm text-slate-400 mb-1">API Key</label>
              <input
                type="password"
                value={rawKey}
                onChange={(event) => setRawKey(event.target.value)}
                placeholder={selectedPreset.placeholder}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm font-mono text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
              />
            </div>
            <div className="mt-4 rounded-2xl border border-white/6 bg-slate-950/40 p-4 text-sm text-slate-300">
              Stored on project <span className="font-medium text-white">{selectedProject?.name || "Selected project"}</span>
              <div className="mt-2 text-xs text-slate-500">
                {selectedPreset.upstream_base_url} · {selectedPreset.auth_header_name} · split client-side before upload
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => void storeKey()}
                disabled={!selectedProjectId || submitting}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Storing..." : "Split & Store"}
              </button>
              <button
                onClick={() => setShowAddKey(false)}
                className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-slate-300 transition hover:bg-white/[0.04]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !error && projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-12 text-center">
            <div className="text-slate-300 mb-2">No projects are available in the selected organization yet.</div>
            <div className="text-sm text-slate-500">Create a project first, then return here to connect a provider.</div>
          </div>
        ) : null}

        {!loading && !error && projects.length > 0 && keys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-12 text-center">
            <div className="text-slate-300 mb-2">No provider keys stored for this project yet.</div>
            <button onClick={() => setShowAddKey(true)} className="text-sm text-emerald-300 transition hover:text-emerald-200">
              Store the first provider key
            </button>
          </div>
        ) : null}

        {!loading && !error && keys.length > 0 ? (
          <div className="space-y-4">
            {keys.map((key) => (
              <div key={key.id} className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-md border px-2.5 py-1 text-xs font-medium ${PROVIDER_COLORS[key.provider] || "bg-white/[0.06] text-slate-200 border-white/10"}`}>
                      {key.provider}
                    </div>
                    <div>
                      <div className="font-semibold text-white">{key.slug || key.provider}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Created {new Date(key.created_at).toLocaleDateString()} · {key.upstream_base_url || "custom upstream"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      active
                    </span>
                    <button
                      onClick={() => void revokeKey(key.id)}
                      className="text-xs text-rose-300 transition hover:text-rose-200"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-500">Project</div>
                    <div className="text-sm text-slate-200">{selectedProject?.name || "Selected project"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Slug</div>
                    <div className="text-sm text-slate-200">{key.slug || key.provider}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Created</div>
                    <div className="text-sm text-slate-200">{timeAgo(key.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Status</div>
                    <div className="text-sm text-emerald-300">Protected</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

export default function KeysDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.18),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_22%),linear-gradient(180deg,_#06101b_0%,_#020712_100%)] text-white">
          <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-300 lg:px-6">
            Loading key workspace...
          </div>
        </div>
      }
    >
      <KeysDashboardInner />
    </Suspense>
  );
}
