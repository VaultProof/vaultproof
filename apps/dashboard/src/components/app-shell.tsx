"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { consumeDashboardNotice, type DashboardNotice } from "../lib/dashboard-notice";
import { getOrganizationHeaders, getSelectedOrganizationId, ORG_EVENT_NAME, setSelectedOrganizationId } from "../lib/org-context";

interface AppShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface OrganizationSummary {
  id: string;
  name: string;
  kind: "personal" | "team";
  role: "owner" | "admin" | "member" | "viewer";
  is_active: boolean;
}

interface ArchivedOrganizationSummary {
  id: string;
  name: string;
  kind: "team";
  role: "owner";
  archived_at: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const PRIMARY_NAV = [
  {
    href: "/",
    label: "Executive",
    blurb: "Chief of staff workflows, approvals, and secure workspace surfaces.",
  },
  {
    href: "/projects",
    label: "Projects",
    blurb: "Shared environments, providers, and rollout status.",
  },
  {
    href: "/keys",
    label: "Keys",
    blurb: "Provider credentials protected behind project access.",
  },
  {
    href: "/members",
    label: "Members",
    blurb: "Roles, access, and invitations across the organization.",
  },
  {
    href: "/audit",
    label: "Audit",
    blurb: "Security events, policy changes, and proxy activity.",
  },
  {
    href: "/alerts",
    label: "Alerts",
    blurb: "Destinations and pilot health delivery setup.",
  },
];

const SECONDARY_NAV = [
  {
    href: "/settings",
    label: "Settings",
  },
  {
    href: "/admin",
    label: "Admin",
  },
  {
    href: "https://vaultproof.dev",
    label: "Website",
  },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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

export function AppShell({
  eyebrow = "VaultProof B2B Build",
  title,
  description,
  actions,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [token, setToken] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [archivedOrganizations, setArchivedOrganizations] = useState<ArchivedOrganizationSummary[]>([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DashboardNotice | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
      }
    }).catch(() => undefined);
  }, []);

  const loadOrganizations = useCallback(async () => {
    if (!token) return;
    try {
      const selected = getSelectedOrganizationId();
      const headers = getOrganizationHeaders(token);
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs`, { headers });
      if (!response.ok) return;
      const payload = await response.json();
      const items = (payload.organizations || []) as OrganizationSummary[];
      const archivedItems = (payload.archived_organizations || []) as ArchivedOrganizationSummary[];
      setOrganizations(items);
      setArchivedOrganizations(archivedItems);

      const hasSelected = selected && items.some((organization) => organization.id === selected);
      const nextActive = hasSelected ? selected : payload.active_organization_id || items[0]?.id || null;
      setActiveOrganizationIdState(nextActive);
      if (nextActive !== selected) {
        setSelectedOrganizationId(nextActive);
      }
    } catch {
      // Sidebar org loading should fail quietly so pages remain usable.
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void loadOrganizations();
    }
  }, [token, loadOrganizations]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void loadOrganizations();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [loadOrganizations, token]);

  useEffect(() => {
    setNotice(consumeDashboardNotice());
  }, [pathname]);

  async function createOrganization() {
    if (!token) return;
    setOrgBusy(true);
    setOrgError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: orgName, slug: orgSlug || null }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setOrgError(payload?.error || "Failed to create organization.");
        return;
      }

      const createdId = payload?.organization?.id || null;
      setOrgName("");
      setOrgSlug("");
      setShowCreateForm(false);
      if (createdId) {
        setSelectedOrganizationId(createdId);
        setActiveOrganizationIdState(createdId);
      }
      await loadOrganizations();
    } catch {
      setOrgError("Network error while creating organization.");
    } finally {
      setOrgBusy(false);
    }
  }

  async function restoreOrganization(organizationId: string, organizationName: string) {
    if (!token) return;
    setOrgBusy(true);
    setOrgError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs/${organizationId}/unarchive`, {
        method: "POST",
        headers: getOrganizationHeaders(token),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setOrgError(payload?.error || "Failed to restore organization.");
        return;
      }

      setSelectedOrganizationId(organizationId);
      setActiveOrganizationIdState(organizationId);
      setNotice({
        type: "success",
        message: `Restored ${organizationName}. It is active in the organization switcher again.`,
      });
      await loadOrganizations();
    } catch {
      setOrgError("Network error while restoring organization.");
    } finally {
      setOrgBusy(false);
    }
  }

  const activeOrganization = organizations.find((organization) => organization.id === activeOrganizationId) || null;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.18),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_22%),linear-gradient(180deg,_#06101b_0%,_#020712_100%)] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 lg:flex-row lg:px-6">
        <aside className="w-full lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)] lg:w-80 lg:flex-shrink-0">
          <div className="flex h-full flex-col rounded-[28px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.5)] backdrop-blur-xl">
            <div className="flex items-center gap-3 border-b border-white/8 pb-5">
              <Image src="/logo2.png" alt="VaultProof" width={44} height={44} />
              <div>
                <div className="text-sm font-semibold tracking-tight text-white">VaultProof</div>
                <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Teams + Enterprise</div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-400/15 bg-emerald-400/8 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">Organization</div>
                <button
                  onClick={() => setShowCreateForm((current) => !current)}
                  className="text-xs text-emerald-100 transition hover:text-white"
                >
                  {showCreateForm ? "Close" : "New Team"}
                </button>
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{activeOrganization?.name || "Personal"}</div>
              <div className="mt-1 text-sm leading-6 text-slate-300">
                {activeOrganization
                  ? `${activeOrganization.kind} org · ${activeOrganization.role}`
                  : "Transitional shell while we move from single-user projects to org-scoped access."}
              </div>

              <select
                value={activeOrganizationId || ""}
                onChange={(event) => {
                  const nextId = event.target.value || null;
                  setActiveOrganizationIdState(nextId);
                  setSelectedOrganizationId(nextId);
                }}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} · {organization.kind} · {organization.role}
                  </option>
                ))}
              </select>

              {showCreateForm ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <input
                    type="text"
                    value={orgName}
                    onChange={(event) => setOrgName(event.target.value)}
                    placeholder="Acme Security"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                  />
                  <input
                    type="text"
                    value={orgSlug}
                    onChange={(event) => setOrgSlug(event.target.value)}
                    placeholder="acme-security (optional)"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                  />
                  {orgError ? <div className="text-xs text-rose-300">{orgError}</div> : null}
                  <button
                    onClick={() => void createOrganization()}
                    disabled={orgBusy}
                    className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {orgBusy ? "Creating..." : "Create Team Organization"}
                  </button>
                </div>
              ) : null}
            </div>

            {archivedOrganizations.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/8 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-amber-200">Archived Teams</div>
                <div className="mt-3 space-y-3">
                  {archivedOrganizations.map((organization) => (
                    <div key={organization.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                      <div className="text-sm font-semibold text-white">{organization.name}</div>
                      <div className="mt-1 text-xs text-slate-400">Archived {timeAgo(organization.archived_at)}</div>
                      <div className="mt-2 text-xs leading-5 text-slate-500">
                        Restore brings the org back into the active switcher with its projects, members, and audit history intact.
                      </div>
                      <button
                        onClick={() => void restoreOrganization(organization.id, organization.name)}
                        disabled={orgBusy}
                        className="mt-3 rounded-xl border border-amber-300/25 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {orgBusy ? "Restoring..." : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <nav className="mt-6 flex-1 space-y-2">
              {PRIMARY_NAV.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={classNames(
                      "block rounded-2xl border px-4 py-3 transition",
                      active
                        ? "border-emerald-400/25 bg-emerald-400/10 shadow-[0_10px_30px_rgba(16,185,129,0.12)]"
                        : "border-white/6 bg-white/[0.03] hover:border-white/12 hover:bg-white/[0.05]",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={classNames("text-sm font-semibold", active ? "text-white" : "text-slate-200")}>
                        {item.label}
                      </span>
                      {active ? (
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-400">{item.blurb}</div>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-white/8 pt-5">
              <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">Secondary</div>
              <div className="space-y-1">
                {SECONDARY_NAV.map((item) => {
                  const external = item.href.startsWith("http");
                  return (
                  <Link
                    key={item.href}
                    href={item.href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                    className={classNames(
                      "flex items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                      pathname === item.href
                        ? "bg-white/[0.07] text-white"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                    )}
                  >
                    <span>{item.label}</span>
                    <span className="text-slate-600">&rarr;</span>
                  </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="rounded-[32px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-3xl">
                <div className="text-[11px] uppercase tracking-[0.22em] text-sky-300">{eyebrow}</div>
                <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
                {description ? (
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{description}</p>
                ) : null}
              </div>
              {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
            </div>

            <div className="mt-6">{children}</div>
            {notice ? (
              <div
                className={classNames(
                  "mt-6 flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-sm",
                  notice.type === "success" && "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
                  notice.type === "warning" && "border-amber-300/20 bg-amber-300/10 text-amber-100",
                  notice.type === "info" && "border-sky-300/20 bg-sky-300/10 text-sky-100",
                )}
              >
                <div>{notice.message}</div>
                <button
                  onClick={() => setNotice(null)}
                  className="text-xs uppercase tracking-[0.18em] text-white/70 transition hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
