"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { consumeDashboardNotice, type DashboardNotice } from "../lib/dashboard-notice";
import { getOrganizationHeaders, ORG_EVENT_NAME, setSelectedOrganizationId } from "../lib/org-context";

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

interface NavItem {
  href: string;
  label: string;
  blurb: string;
  pill?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const PRIMARY_NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    blurb: "Runtime posture, access, evidence, and urgent actions.",
  },
  {
    href: "/projects",
    label: "Projects",
    blurb: "Apps, environments, policy, health, and rollout status.",
  },
  {
    href: "/keys",
    label: "Provider slots",
    blurb: "Protected provider credentials, rotation, and revoke controls.",
  },
  {
    href: "/members",
    label: "Members",
    blurb: "Invites, org roles, and project permissions.",
  },
  {
    href: "/alerts",
    label: "Alerts",
    blurb: "Destinations, dispatch rules, and delivery history.",
  },
];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      ...PRIMARY_NAV.slice(0, 2),
      { href: "/readiness", label: "Readiness", blurb: "Production readiness checks for runtime and edge posture." },
      { href: "/health", label: "Health", blurb: "Live health response for operators and uptime checks." },
      { href: "/app/activity", label: "Activity", blurb: "Runtime traffic, errors, hot endpoints, and provider mix." },
      PRIMARY_NAV[4],
      { href: "/app/control", label: "Control", blurb: "Caller lock, provider policy, rates, and secure execution." },
      { href: "/app/verifier", label: "AI Proof Verifier", blurb: "Register models and verify external proof bundles.", pill: "beta" },
    ],
  },
  {
    label: "Evidence",
    items: [
      PRIMARY_NAV[3],
      PRIMARY_NAV[4],
      PRIMARY_NAV[2],
      { href: "/api/v1/enterprise/members/access-review?format=csv", label: "Access review CSV", blurb: "Export members, roles, assignments, and invites." },
    ],
  },
  {
    label: "Guides",
    items: [
      { href: "/app/setup", label: "Setup guide", blurb: "Implementation order for enterprise rollout." },
      { href: "/app/technical-guide", label: "Technical guide", blurb: "Identity, network, custody, attestation, and rollout reference." },
      { href: "/settings", label: "Settings", blurb: "Tenant defaults and sensitive lifecycle controls." },
      { href: "/app/plans", label: "Plans", blurb: "Launch readiness, edge status, and handoff notes." },
      { href: "/app/scanner", label: "Scanner", blurb: "Repository scanning launch checklist." },
      { href: "/app/runbooks", label: "Runbooks", blurb: "Verification, evidence, deploys, rotation, DNS, edge, and cleanup." },
    ],
  },
  {
    label: "Help",
    items: [
      { href: "https://vaultproof.dev/docs", label: "Docs", blurb: "Product and integration documentation." },
      { href: "https://vaultproof.dev/status", label: "Status", blurb: "Service status and uptime notices." },
      { href: "mailto:hello@vaultproof.dev", label: "Support", blurb: "Contact VaultProof support." },
      { href: "/app/logout", label: "Sign out", blurb: "End this enterprise session." },
      { href: "/admin", label: "Admin", blurb: "Staff-only operating metrics." },
    ],
  },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
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
      const headers = getOrganizationHeaders(token);
      const response = await fetch(`${BACKEND_URL}/api/v1/init/orgs`, { headers });
      if (!response.ok) return;
      const payload = await response.json();
      const items = (payload.organizations || []) as OrganizationSummary[];
      setOrganizations(items);

      const nextActive = payload.active_organization_id || items[0]?.id || null;
      setActiveOrganizationIdState(nextActive);
      setSelectedOrganizationId(nextActive);
    } catch {
      // Sidebar org loading should fail quietly so pages remain usable.
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const timeoutId = window.setTimeout(() => {
      void loadOrganizations();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [token, loadOrganizations]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void loadOrganizations();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [loadOrganizations, token]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setNotice(consumeDashboardNotice());
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const activeOrganization = organizations.find((organization) => organization.id === activeOrganizationId) || null;
  const activePage = PRIMARY_NAV.find((item) => item.href === pathname) || PRIMARY_NAV[0];

  return (
    <div className="enterprise-dashboard min-h-screen bg-[#f6f7f2] text-[#18231d]">
      <div className="mx-auto grid max-w-[1480px] gap-5 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-6">
        <aside className="order-2 w-full lg:order-1 lg:self-start">
          <div className="flex flex-col rounded-[22px] border border-[#17372f]/20 bg-[#10231d] p-4 text-white shadow-[0_22px_60px_rgba(22,35,29,0.18)]">
            <div className="border-b border-white/10 pb-4">
              <div className="text-base font-semibold tracking-tight text-white">VaultProof Enterprise</div>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#8fe0c1]">confidential dashboard</div>
            </div>

            <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8fe0c1]">Organization Workspace</div>
              <div className="mt-3 text-lg font-semibold text-white">{activeOrganization?.name || "Provisioning pending"}</div>
              <div className="mt-1 text-sm leading-6 text-white/70">
                {activeOrganization
                  ? `${activeOrganization.kind} org · ${activeOrganization.role} access`
                  : "VaultProof will provision this workspace for your organization."}
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-[#0a1914] px-3 py-2.5 text-xs leading-5 text-white/60">
                Workspace selection is managed by VaultProof for this deployment.
              </div>
            </div>

            <nav className="mt-4 space-y-4">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">{group.label}</div>
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const external = item.href.startsWith("http") || item.href.startsWith("mailto:");
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={`${group.label}-${item.href}-${item.label}`}
                          href={item.href}
                          target={external ? "_blank" : undefined}
                          rel={external ? "noreferrer" : undefined}
                          className={classNames(
                            "block rounded-[14px] border px-3 py-2.5 transition",
                            active
                              ? "border-[#8fe0c1]/40 bg-[#8fe0c1]/15"
                              : "border-white/8 bg-transparent hover:bg-white/[0.06]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">{item.label}</span>
                            {item.pill ? (
                              <span className="rounded-full border border-[#8fe0c1]/30 px-2 py-0.5 text-[10px] uppercase text-[#8fe0c1]">{item.pill}</span>
                            ) : active ? (
                              <span className="h-2 w-2 rounded-full bg-[#8fe0c1]" />
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-white/55">{item.blurb}</div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <main className="enterprise-content order-1 min-w-0 lg:order-2">
          <div className="rounded-[22px] border border-[#dfe5dc] bg-white p-4 shadow-[0_18px_60px_rgba(22,35,29,0.08)] sm:p-5">
            <div className="rounded-[18px] border border-[#dfe5dc] bg-[#fbfcf8] p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex rounded-full border border-[#ccd8cf] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3d6f5b]">
                    {eyebrow}
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#17231d] sm:text-[2.6rem]">{title}</h1>
                  {description ? (
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-[#52625a] sm:text-base">{description}</p>
                  ) : null}
                </div>
                {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
                <div className="rounded-2xl border border-[#dce5df] bg-white p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8c84]">You are here</div>
                  <div className="mt-2 text-sm font-semibold text-[#17231d]">{activePage.label}</div>
                  <div className="mt-1 text-sm leading-6 text-[#5f6f67]">{activePage.blurb}</div>
                </div>
                <div className="rounded-2xl border border-[#dce5df] bg-white p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8c84]">Active org</div>
                  <div className="mt-2 text-sm font-semibold text-[#17231d]">{activeOrganization?.name || "Provisioning pending"}</div>
                  <div className="mt-1 text-sm leading-6 text-[#5f6f67]">
                    {activeOrganization ? `${activeOrganization.role} access` : "VaultProof will provision this organization workspace."}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#dce5df] bg-white p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8c84]">Next best step</div>
                  <div className="mt-2 text-sm font-semibold text-[#34514c]">
                    {pathname === "/projects" ? "Review project health" : pathname === "/keys" ? "Review provider slots" : pathname === "/members" ? "Review team access" : "Review the latest signal"}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[#5f6f67]">Use the navigation to move between enterprise controls.</div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              {children}
            </div>
            {notice ? (
              <div
                className={classNames(
                  "mt-6 flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-sm",
                  notice.type === "success" && "border-emerald-400/20 bg-emerald-400/10 text-emerald-800",
                  notice.type === "warning" && "border-amber-300/30 bg-amber-300/15 text-amber-900",
                  notice.type === "info" && "border-sky-300/30 bg-sky-300/15 text-sky-900",
                )}
              >
                <div>{notice.message}</div>
                <button
                  onClick={() => setNotice(null)}
                  className="text-xs uppercase tracking-[0.16em] text-[#58665f] transition hover:text-[#17231d]"
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
