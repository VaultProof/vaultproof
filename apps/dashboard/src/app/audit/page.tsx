"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";
import { getOrganizationHeaders, ORG_EVENT_NAME } from "../../lib/org-context";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

interface AuditEvent {
  id: string;
  source: "governance" | "proxy";
  timestamp: string;
  event_type: string;
  actor: string;
  description: string;
  project: {
    id: string;
    name: string | null;
    vp_proj_id: string;
  } | null;
  status: number | null;
  metadata: Record<string, unknown>;
}

interface AuditResponse {
  organization: {
    id: string;
    name: string;
    kind: "personal" | "team";
    current_role: "owner" | "admin" | "member" | "viewer";
  } | null;
  summary: {
    governanceEvents: number;
    proxyEvents: number;
    totalEvents: number;
  };
  filters?: {
    source: "all" | AuditEvent["source"];
    project_id: string | null;
    event_type: string | null;
    before: string | null;
    days: number;
    limit: number;
  };
  has_more?: boolean;
  next_before?: string | null;
  events: AuditEvent[];
}

interface AuditChip {
  label: string;
  value: string;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function humanizeEventType(eventType: string): string {
  const labels: Record<string, string> = {
    organization_created: "Organization Created",
    organization_updated: "Organization Updated",
    organization_archived: "Organization Archived",
    organization_unarchived: "Organization Restored",
    organization_ownership_transferred: "Ownership Transferred",
    organization_invitation_created: "Invitation Sent",
    organization_invitation_accepted: "Invitation Accepted",
    organization_invitation_revoked: "Invitation Revoked",
    organization_member_role_updated: "Org Role Updated",
    organization_member_removed: "Member Removed",
    project_created: "Project Created",
    project_policy_updated: "Project Policy Updated",
    project_member_added: "Project Access Added",
    project_member_updated: "Project Access Updated",
    project_member_removed: "Project Access Removed",
    project_revoked: "Project Disabled",
    project_key_rotated: "Provider Key Rotated",
    project_key_revoked: "Provider Key Revoked",
    proxy_request: "Proxy Request",
    proxy_error: "Proxy Error",
  };
  return labels[eventType] || titleCase(eventType);
}

function buildAuditChips(event: AuditEvent): AuditChip[] {
  const metadata = event.metadata || {};
  const chips: AuditChip[] = [];
  const pushChip = (label: string, value: string | null) => {
    if (!value) return;
    chips.push({ label, value });
  };

  if (event.source === "proxy") {
    pushChip("Provider", readMetadataString(metadata, "provider"));
    pushChip("Method", readMetadataString(metadata, "method"));
    pushChip("Endpoint", readMetadataString(metadata, "endpoint"));
    const latency = readMetadataString(metadata, "latency_ms");
    pushChip("Latency", latency ? `${latency} ms` : null);
    if (chips.length > 4) return chips.slice(0, 4);
    return chips;
  }

  pushChip("Target", readMetadataString(metadata, "target_type") ? titleCase(readMetadataString(metadata, "target_type") || "") : null);
  pushChip("Role", readMetadataString(metadata, "role"));
  pushChip("Previous Role", readMetadataString(metadata, "previous_role"));
  pushChip("Invited Email", readMetadataString(metadata, "invited_email"));
  pushChip("Target User", readMetadataString(metadata, "target_user_id"));
  pushChip("New Owner", readMetadataString(metadata, "new_owner_user_id"));

  const removedAssignments = readMetadataString(metadata, "removed_project_assignments");
  pushChip("Assignments Removed", removedAssignments);

  const strictOrigin = metadata.strict_origin;
  if (typeof strictOrigin === "boolean") {
    chips.push({ label: "Strict Origin", value: strictOrigin ? "On" : "Off" });
  }

  return chips.slice(0, 5);
}

function buildAuditDetails(event: AuditEvent): AuditChip[] {
  const metadata = event.metadata || {};
  const details: AuditChip[] = [];
  const pushDetail = (label: string, value: string | null) => {
    if (!value) return;
    details.push({ label, value });
  };

  if (event.project) {
    pushDetail("Project ID", event.project.vp_proj_id);
  }

  if (event.source === "proxy") {
    pushDetail("Proxy Key", readMetadataString(metadata, "slug"));
    pushDetail("Error", readMetadataString(metadata, "error"));
    return details;
  }

  pushDetail("Target ID", readMetadataString(metadata, "target_id"));
  pushDetail("Name", readMetadataString(metadata, "name"));
  pushDetail("Slug", readMetadataString(metadata, "slug"));
  pushDetail("New Owner", readMetadataString(metadata, "new_owner_user_id"));
  pushDetail("Previous Owner", readMetadataString(metadata, "previous_owner_user_id"));
  pushDetail("Allowed Origins", readMetadataString(metadata, "allowed_origins"));

  return details;
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

function statusTone(source: AuditEvent["source"], status: number | null): string {
  if (source === "governance") return "border-sky-400/20 bg-sky-400/10 text-sky-200";
  if (status !== null && status >= 400) return "border-rose-400/20 bg-rose-400/10 text-rose-200";
  return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
}

export default function AuditPage() {
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | AuditEvent["source"]>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

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
      } else {
        setError("Not logged in. Sign in at vaultproof.dev first.");
        setLoading(false);
      }
    }).catch(() => {
      setError("Unable to check login status. Try refreshing.");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const fetchData = useCallback(async (before?: string | null) => {
    if (!token) return;
    if (before) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({
        days: "30",
        limit: "50",
      });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (projectFilter !== "all") params.set("project_id", projectFilter);
      if (eventTypeFilter !== "all") params.set("event_type", eventTypeFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (before) params.set("before", before);

      const response = await fetch(`${BACKEND_URL}/api/v1/init/audit?${params.toString()}`, {
        headers: getOrganizationHeaders(token),
      });

      if (!response.ok) {
        setError("Failed to load audit events. Try refreshing.");
        return;
      }

      const payload = await response.json();
      setData((current) => {
        if (!before || !current) return payload;
        const seen = new Set(current.events.map((event) => event.id));
        const mergedEvents = [...current.events];
        for (const event of payload.events || []) {
          if (!seen.has(event.id)) {
            mergedEvents.push(event);
          }
        }
        return {
          ...payload,
          events: mergedEvents,
          summary: {
            governanceEvents: mergedEvents.filter((event: AuditEvent) => event.source === "governance").length,
            proxyEvents: mergedEvents.filter((event: AuditEvent) => event.source === "proxy").length,
            totalEvents: mergedEvents.length,
          },
        };
      });
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      if (before) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [debouncedQuery, eventTypeFilter, projectFilter, sourceFilter, token]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void fetchData();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [fetchData, token]);

  useEffect(() => {
    if (token) {
      void fetchData();
    }
  }, [debouncedQuery, eventTypeFilter, projectFilter, sourceFilter, token, fetchData]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: "Governance Events",
        value: String(data?.summary.governanceEvents ?? 0),
        detail: "Invites, accepts, project changes, and assignment actions.",
      },
      {
        label: "Proxy Events",
        value: String(data?.summary.proxyEvents ?? 0),
        detail: "Runtime requests already captured by the worker proxy path.",
      },
      {
        label: "Unified Timeline",
        value: String(data?.summary.totalEvents ?? 0),
        detail: "Merged governance + runtime feed for the last 30 days.",
      },
      {
        label: "Organization",
        value: data?.organization?.name || "No org yet",
        detail: data?.organization ? `Current role: ${data.organization.current_role}` : "Audit view activates once membership exists.",
      },
    ];
  }, [data]);

  const availableProjects = useMemo(() => {
    const items = new Map<string, { id: string; name: string | null; vp_proj_id: string }>();
    for (const event of data?.events || []) {
      if (!event.project) continue;
      items.set(event.project.id, event.project);
    }
    return [...items.values()].sort((a, b) => {
      const aLabel = a.name || a.vp_proj_id;
      const bLabel = b.name || b.vp_proj_id;
      return aLabel.localeCompare(bLabel);
    });
  }, [data]);

  const availableEventTypes = useMemo(() => {
    return [...new Set((data?.events || []).map((event) => event.event_type))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filteredEvents = useMemo(() => data?.events || [], [data]);

  const filteredCounts = useMemo(() => {
    const governance = filteredEvents.filter((event) => event.source === "governance").length;
    const proxy = filteredEvents.filter((event) => event.source === "proxy").length;
    return {
      governance,
      proxy,
      total: filteredEvents.length,
    };
  }, [filteredEvents]);

  return (
    <AppShell
      eyebrow="Audit and exports"
      title="Audit"
      description="Search governance and runtime events, prepare CSV evidence, and review customer-verifiable metadata."
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{card.label}</div>
            <div className="mt-3 text-3xl font-bold text-white">{card.value}</div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[180px] flex-1">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Search</label>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="actor, project, provider, endpoint"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Source</label>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as "all" | AuditEvent["source"])}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
            >
              <option value="all">All sources</option>
              <option value="governance">Governance</option>
              <option value="proxy">Proxy</option>
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Project</label>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
            >
              <option value="all">All projects</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || project.vp_proj_id}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Event Type</label>
            <select
              value={eventTypeFilter}
              onChange={(event) => setEventTypeFilter(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
            >
              <option value="all">All event types</option>
              {availableEventTypes.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {eventType}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
          <span>Filtered governance: {filteredCounts.governance}</span>
          <span>Filtered proxy: {filteredCounts.proxy}</span>
          <span>Filtered total: {filteredCounts.total}</span>
        </div>
      </div>

      {loading ? <div className="mt-6 py-20 text-center text-slate-400">Loading unified audit feed...</div> : null}
      {error && !loading ? (
        <div className="mt-6 rounded-[26px] border border-red-500/20 bg-red-500/10 p-6 text-center text-red-300">{error}</div>
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Unified Event Stream</div>
            <div className="mt-5 space-y-4">
              {filteredEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  No audit events match the current filters.
                </div>
              ) : (
                filteredEvents.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${statusTone(item.source, item.status)}`}>
                          {item.source}
                        </span>
                        <div className="text-sm font-semibold text-white">{humanizeEventType(item.event_type)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{timeAgo(item.timestamp)}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(item.timestamp)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-200">{item.description}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>Actor: {item.actor}</span>
                      {item.project ? <span>Project: {item.project.name || item.project.vp_proj_id}</span> : null}
                      {item.status !== null ? <span>Status: {item.status}</span> : null}
                    </div>
                    {buildAuditChips(item).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {buildAuditChips(item).map((chip) => (
                          <span
                            key={`${item.id}-${chip.label}-${chip.value}`}
                            className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-slate-200"
                            title={`${chip.label}: ${chip.value}`}
                          >
                            <span className="text-slate-400">{chip.label}:</span> {chip.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {buildAuditDetails(item).length > 0 ? (
                      <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                        {buildAuditDetails(item).map((detail) => (
                          <div key={`${item.id}-${detail.label}-${detail.value}`} className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2">
                            <span className="text-slate-500">{detail.label}:</span> {detail.value}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {data?.has_more ? (
              <div className="mt-5 flex justify-center">
                <button
                  onClick={() => void fetchData(data.next_before || null)}
                  disabled={loadingMore || !data.next_before}
                  className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Coverage</div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Governance events</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  Project creation, policy updates, invites, invite acceptance, project assignment, key rotate, key revoke, and project revoke now write into a durable audit table.
                </div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Runtime events</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  Existing `project_access_logs` continue to capture proxy activity, including errors and denied upstream traffic patterns.
                </div>
              </div>
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Next layer</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  The feed now pages, searches server-side, and highlights the most important event metadata directly in each card. Next up is larger-volume tuning and export workflows.
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
