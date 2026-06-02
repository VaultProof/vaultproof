"use client";

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  ApprovalItem,
  AssistantMode,
  AssistantProfile,
  ExecutiveStateSnapshot,
  WorkflowItem,
} from "../lib/executive-mvp";
import type { InternalFinanceSnapshot } from "../lib/internal-finance";

const EMPTY_STATE: ExecutiveStateSnapshot = {
  profiles: [],
  sessions: {
    chief_of_staff: { assistantId: "chief_of_staff", messages: [], artifact: { title: "", summary: "", bullets: [], updatedAt: new Date(0).toISOString() } },
    revenue: { assistantId: "revenue", messages: [], artifact: { title: "", summary: "", bullets: [], updatedAt: new Date(0).toISOString() } },
    board: { assistantId: "board", messages: [], artifact: { title: "", summary: "", bullets: [], updatedAt: new Date(0).toISOString() } },
  },
  approvals: [],
  workflows: [],
  toolEvents: [],
  auditEvents: [],
};

const RISK_STYLES: Record<ApprovalItem["risk"], string> = {
  low: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  medium: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  high: "border-rose-400/20 bg-rose-400/10 text-rose-100",
};

const WORKFLOW_STYLES: Record<WorkflowItem["status"], string> = {
  healthy: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  watch: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  draft: "border-slate-400/20 bg-white/[0.04] text-slate-200",
};

const SCENARIO_STYLES: Record<InternalFinanceSnapshot["scenarios"][number]["status"], string> = {
  base: "border-sky-300/20 bg-sky-300/10 text-sky-100",
  watch: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  extension: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
};

const CONTROL_CENTER_LINKS = [
  ["Project health", "Review environments, traffic, policy status, and allowed origins.", "/projects"],
  ["Provider slots", "View active providers, rotation checklists, and emergency revoke controls.", "/keys"],
  ["Access evidence", "Review members, pending invites, roles, and project assignments.", "/members"],
  ["Alert delivery", "Manage destinations, delivery logs, dispatch runs, and policy state.", "/alerts"],
] as const;

const ENTERPRISE_LINK_GROUPS = [
  {
    title: "Evidence links",
    detail: "The old enterprise console put readiness, health, and review exports within one click for operators.",
    links: [
      ["Production readiness", "/readiness"],
      ["Control-plane health", "/health"],
      ["Access review CSV", "/api/v1/enterprise/members/access-review?format=csv"],
    ],
  },
  {
    title: "Security controls",
    detail: "Caller lock, provider custody, SSO, and proof verification are the core enterprise controls.",
    links: [
      ["Policy control", "/app/control"],
      ["Provider slots", "/keys"],
      ["Members + access", "/app/members"],
      ["AI Proof Verifier", "/app/verifier"],
    ],
  },
  {
    title: "Operator resources",
    detail: "Setup, launch, scanner, and runbook material remain available without taking over workspace provisioning.",
    links: [
      ["Setup guide", "/app/setup"],
      ["Technical guide", "/app/technical-guide"],
      ["Launch plans", "/app/plans"],
      ["Scanner", "/app/scanner"],
      ["Runbooks", "/app/runbooks"],
    ],
  },
  {
    title: "Support",
    detail: "Keep public docs and service status visible for teams moving between implementation and operations.",
    links: [
      ["Docs", "https://vaultproof.dev/docs"],
      ["Status", "https://vaultproof.dev/status"],
      ["Support", "mailto:hello@vaultproof.dev"],
    ],
  },
] as const;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatMoney(value: number) {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  }
  return `$${Math.round(value / 1000)}k`;
}

function formatTimeAgo(iso: string | null) {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchExecutiveState(token: string) {
  const response = await fetch("/api/executive", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Failed to load executive workspace.");
  }
  const payload = await response.json();
  return payload.state as ExecutiveStateSnapshot;
}

async function postExecutiveAction(token: string, body: Record<string, unknown>) {
  const response = await fetch("/api/executive", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Executive action failed.");
  }
  const payload = await response.json();
  return payload.state as ExecutiveStateSnapshot;
}

async function fetchInternalFinance(token: string) {
  const response = await fetch("/api/internal-finance", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Failed to load internal finance.");
  }
  const payload = await response.json();
  return payload.finance as InternalFinanceSnapshot;
}

async function postInternalFinanceAction(token: string, body: Record<string, unknown>) {
  const response = await fetch("/api/internal-finance", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Internal finance action failed.");
  }
  const payload = await response.json();
  return payload.finance as InternalFinanceSnapshot;
}

export function ExecutivePortalShell() {
  const [state, setState] = useState<ExecutiveStateSnapshot>(EMPTY_STATE);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!supabase);
  const [finance, setFinance] = useState<InternalFinanceSnapshot | null>(null);
  const [activeAssistant, setActiveAssistant] = useState<AssistantMode>("chief_of_staff");
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(supabase ? null : "Dashboard sign-in is not configured.");
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [pendingMessage, startMessageTransition] = useTransition();
  const [pendingAction, startActionTransition] = useTransition();
  const [pendingFinanceAction, startFinanceTransition] = useTransition();

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const accessToken = data.session?.access_token || null;
      setSessionToken(accessToken);
      setSessionChecked(true);
      if (!accessToken) {
        setLoading(false);
        setError("Sign in with an approved VaultProof employee account to access this dashboard.");
      }
    }).catch(() => {
      if (cancelled) return;
      setSessionChecked(true);
      setLoading(false);
      setError("Could not read the current dashboard session.");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionToken(session?.access_token || null);
      setSessionChecked(true);
      if (!session?.access_token) {
        setFinance(null);
        setLoading(false);
        setError("Sign in with an approved VaultProof employee account to access this dashboard.");
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!sessionToken) return;

    let cancelled = false;
    const tokenForRequest = sessionToken;
    async function loadExecutiveState() {
      setLoading(true);
      try {
        const nextState = await fetchExecutiveState(tokenForRequest);
        if (cancelled) return;
        setState(nextState);
        setError(null);
        setLoading(false);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load executive workspace.");
        setLoading(false);
      }
    }

    void loadExecutiveState();

    return () => {
      cancelled = true;
    };
  }, [sessionChecked, sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;

    fetchInternalFinance(sessionToken)
      .then((snapshot) => {
        if (cancelled) return;
        setFinance(snapshot);
        setFinanceError(null);
      })
      .catch((loadError: Error) => {
        if (cancelled) return;
        setFinanceError(loadError.message);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const profile = useMemo<AssistantProfile | null>(
    () => state.profiles.find((assistant) => assistant.id === activeAssistant) || null,
    [activeAssistant, state.profiles],
  );
  const session = state.sessions[activeAssistant];
  const pendingApprovals = useMemo(
    () => state.approvals.filter((approval) => approval.status === "pending"),
    [state.approvals],
  );
  const highRiskApprovals = useMemo(
    () => pendingApprovals.filter((approval) => approval.risk === "high").length,
    [pendingApprovals],
  );
  const latestToolEvent = state.toolEvents[0] || null;
  const financeLoading = Boolean(sessionToken && !finance && !financeError);
  const activeFinanceScenario = useMemo(
    () => finance?.scenarios.find((scenario) => scenario.id === finance.activeScenarioId) || finance?.scenarios[0] || null,
    [finance],
  );
  const largestBurnCategory = useMemo(
    () => finance?.categories.reduce((largest, category) => category.amountUsd > largest.amountUsd ? category : largest, { id: "", label: "None", amountUsd: 0, trend: "flat" as const }) || null,
    [finance],
  );

  async function applyAction(body: Record<string, unknown>) {
    if (!sessionToken) {
      throw new Error("Sign in is required before running executive actions.");
    }
    setError(null);
    const nextState = await postExecutiveAction(sessionToken, body);
    setState(nextState);
  }

  function submitChat() {
    const body = composer.trim();
    if (!body) return;
    setComposer("");
    startMessageTransition(() => {
      void applyAction({ action: "chat", assistantId: activeAssistant, body }).catch((actionError: Error) => {
        setError(actionError.message);
      });
    });
  }

  function triggerAction(body: Record<string, unknown>) {
    startActionTransition(() => {
      void applyAction(body).catch((actionError: Error) => {
        setError(actionError.message);
      });
    });
  }

  function triggerFinanceAction(body: Record<string, unknown>) {
    if (!sessionToken) return;
    startFinanceTransition(() => {
      void postInternalFinanceAction(sessionToken, body)
        .then((snapshot) => {
          setFinance(snapshot);
          setFinanceError(null);
        })
        .catch((actionError: Error) => {
          setFinanceError(actionError.message);
        });
    });
  }

  if (loading) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
        Loading the executive workspace...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_48px_rgba(2,6,23,0.18)]">
        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">Enterprise dashboard</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
              Runtime, access, and evidence in one control center.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              This dashboard uses the same operating model as the enterprise control plane: confirm confidential runtime
              readiness, review provider slots and caller-lock policy, then export evidence for audit and access review.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Production runtime", "check", "Confidential VM, executor, attestation, replay protection, and KMS path."],
                ["Access review", String(pendingApprovals.length), highRiskApprovals ? `${highRiskApprovals} high-risk approvals held` : "Members, roles, and project access evidence."],
                ["Provider slots", "review", "Active providers, rotation notes, caller lock, and emergency revoke."],
                ["30d evidence", String(state.auditEvents.length), latestToolEvent ? `${latestToolEvent.tool} · ${latestToolEvent.status}` : "Governance and runtime activity exports."],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-2xl border border-white/8 bg-slate-950/35 p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-400">{detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[26px] border border-emerald-400/15 bg-emerald-400/8 p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">Confidential runtime posture</div>
            <div className="mt-3 text-lg font-semibold text-white">Daily operator check</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The enterprise pages frame runtime security around the GCP confidential host, Cloud KMS unwrap path,
              replay protection, and launch hardening checks.
            </p>
            <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-300">
              <div className="rounded-2xl border border-white/8 bg-slate-950/35 px-3 py-2">Confidential VM runtime host</div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/35 px-3 py-2">Cloud KMS provider-key path</div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/35 px-3 py-2">Replay protection for signed envelopes</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/members" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.07]">
                Access evidence
              </Link>
              <Link href="/keys" className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300">
                Provider slots
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {CONTROL_CENTER_LINKS.map(([label, detail, href]) => (
            <Link
              key={href}
              href={href}
              className="rounded-2xl border border-white/8 bg-slate-950/35 p-4 transition hover:border-emerald-400/25 hover:bg-emerald-400/8"
            >
              <div className="text-sm font-semibold text-white">{label}</div>
              <div className="mt-2 text-sm leading-6 text-slate-400">{detail}</div>
              <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Open</div>
            </Link>
          ))}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {ENTERPRISE_LINK_GROUPS.map((group) => (
            <div key={group.title} className="rounded-2xl border border-white/8 bg-slate-950/35 p-4">
              <div className="text-sm font-semibold text-white">{group.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-400">{group.detail}</div>
              <div className="mt-4 grid gap-2">
                {group.links.map(([label, href]) => {
                  const external = href.startsWith("http") || href.startsWith("mailto:");
                  return (
                    <Link
                      key={href}
                      href={href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noreferrer" : undefined}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm font-medium text-white transition hover:border-emerald-400/25 hover:bg-emerald-400/8"
                    >
                      <span>{label}</span>
                      <span className="text-xs uppercase text-emerald-300">Open</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {sessionToken ? (
        <section className="rounded-[30px] border border-white/10 bg-slate-950/40 p-5">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">ZKMark internal</div>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">Burn rate and runway</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Internal operating view for signed-in dashboard sessions only. This data is served by a separate
                authenticated endpoint and does not live in the customer executive API.
              </p>
            </div>
            <button
              onClick={() => triggerFinanceAction({ action: "review" })}
              disabled={pendingFinanceAction || financeLoading || !finance}
              className="w-fit rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Queue review
            </button>
          </div>

          {financeError ? (
            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {financeError}
            </div>
          ) : null}

          {financeLoading && !finance ? (
            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-300">
              Loading signed-in finance view...
            </div>
          ) : null}

          {finance ? (
            <>
              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[0.9fr_1.3fr_0.8fr]">
                <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Current model</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {[
                      ["Cash", formatMoney(finance.cashOnHandUsd)],
                      ["Monthly burn", formatMoney(finance.monthlyBurnUsd)],
                      ["Runway", `${finance.runwayMonths.toFixed(1)} mo`],
                      ["Committed rev", formatMoney(finance.committedRevenueUsd)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/8 bg-slate-950/45 p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                  {largestBurnCategory ? (
                    <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/8 p-3 text-sm leading-6 text-sky-100">
                      Largest burn center is {largestBurnCategory.label} at {formatMoney(largestBurnCategory.amountUsd)}
                      per month.
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Scenario planner</div>
                      <div className="mt-2 text-lg font-semibold text-white">{activeFinanceScenario?.label || "No scenario"}</div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                      Updated {formatTimeAgo(finance.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {finance.scenarios.map((scenario) => {
                      const active = scenario.id === finance.activeScenarioId;
                      return (
                        <button
                          key={scenario.id}
                          onClick={() => triggerFinanceAction({ action: "scenario", scenarioId: scenario.id })}
                          disabled={pendingFinanceAction || financeLoading}
                          className={classNames(
                            "rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                            active
                              ? "border-emerald-400/30 bg-emerald-400/10"
                              : "border-white/8 bg-slate-950/35 hover:border-white/16",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white">{scenario.label}</div>
                            <span className={classNames("rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em]", SCENARIO_STYLES[scenario.status])}>
                              {scenario.status}
                            </span>
                          </div>
                          <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{scenario.runwayMonths.toFixed(1)} mo</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{formatMoney(scenario.monthlyBurnUsd)} burn</div>
                          <p className="mt-3 text-sm leading-6 text-slate-300">{scenario.note}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Burn mix</div>
                  <div className="mt-4 space-y-3">
                    {finance.categories.map((category) => {
                      const width = finance.monthlyBurnUsd
                        ? Math.max(8, Math.round((category.amountUsd / finance.monthlyBurnUsd) * 100))
                        : 0;
                      return (
                        <div key={category.id}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-white">{category.label}</span>
                            <span className="text-slate-400">{formatMoney(category.amountUsd)} / {category.trend}</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-white/[0.06]">
                            <div className="h-2 rounded-full bg-emerald-300" style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {finance.watchItems.map((item) => (
                  <div key={item} className="rounded-2xl border border-amber-300/15 bg-amber-300/8 p-4 text-sm leading-6 text-amber-50">
                    {item}
                  </div>
                ))}
              </div>

              {finance.reviewQueue.length > 0 ? (
                <div className="mt-4 rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Review queue</div>
                  <div className="mt-3 space-y-2">
                    {finance.reviewQueue.map((item) => (
                      <div key={item} className="rounded-2xl border border-white/8 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <section className="rounded-[30px] border border-white/10 bg-slate-950/40 p-5">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Workspace</div>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">Operator brief console</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Draft briefs, artifacts, approvals, and playbook runs without leaving the enterprise evidence workflow.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {state.profiles.map((assistant) => {
                const active = assistant.id === activeAssistant;
                return (
                  <button
                    key={assistant.id}
                    onClick={() => setActiveAssistant(assistant.id)}
                    className={classNames(
                      "rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
                      active
                        ? "border-emerald-400/25 bg-emerald-400/10 text-white"
                        : "border-white/8 bg-white/[0.03] text-slate-300 hover:border-white/14 hover:text-white",
                    )}
                  >
                    {assistant.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-white/8 bg-slate-950/45 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{profile?.label || "Assistant"}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-emerald-300">{profile?.tone || "Workspace"}</div>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                  Secure mode
                </span>
              </div>

              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                {profile?.promise}
              </div>

              <div className="mt-4 space-y-3">
                {session.messages.map((message) => (
                  <div
                    key={message.id}
                    className={classNames(
                      "rounded-2xl border px-4 py-3 text-sm leading-6",
                      message.role === "system" && "border-sky-300/15 bg-sky-300/8 text-sky-100",
                      message.role === "user" && "border-white/8 bg-white/[0.04] text-slate-100",
                      message.role === "assistant" && "border-emerald-400/15 bg-emerald-400/8 text-emerald-50",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] opacity-70">
                      <span>{message.role}</span>
                      <span>{formatTimeAgo(message.createdAt)}</span>
                    </div>
                    <div>{message.body}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[24px] border border-white/10 bg-slate-950/65 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Send a local prompt</div>
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  placeholder="Ask for a brief, memo, board rewrite, or escalation plan..."
                  className="mt-3 min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/30"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={submitChat}
                    disabled={pendingMessage || pendingAction || !composer.trim()}
                    className="rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingMessage ? "Sending..." : "Send"}
                  </button>
                  <button
                    onClick={() => setComposer("Give me the shortest read on what matters today and queue anything sensitive for approval.")}
                    disabled={pendingMessage || pendingAction}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-200 transition hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Insert starter prompt
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Artifact</div>
                    <div className="mt-2 text-lg font-semibold text-white">{session.artifact.title}</div>
                  </div>
                  <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-sky-100">
                    Updated {formatTimeAgo(session.artifact.updatedAt)}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{session.artifact.summary}</p>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-200">
                  {session.artifact.bullets.map((bullet) => (
                    <li key={bullet} className="rounded-2xl border border-white/8 bg-slate-950/40 px-3 py-2">
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recent tool activity</div>
                <div className="mt-3 space-y-3">
                  {state.toolEvents.slice(0, 4).map((event) => (
                    <div key={event.id} className="rounded-2xl border border-white/8 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">{event.tool}</div>
                        <span className={classNames(
                          "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em]",
                          event.status === "ok"
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                            : "border-amber-300/20 bg-amber-300/10 text-amber-100",
                        )}>
                          {event.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{event.summary}</div>
                      <div className="mt-2 text-xs text-slate-500">{formatTimeAgo(event.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="dashboard-right-sidebar space-y-5">
          <section className="rounded-[28px] border border-white/10 bg-slate-950/40 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Approvals inbox</div>
                <div className="mt-2 text-lg font-semibold text-white">Held actions</div>
              </div>
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-100">
                {pendingApprovals.length} pending
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {pendingApprovals.map((approval) => (
                <div key={approval.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white">{approval.title}</div>
                    <span className={classNames("rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em]", RISK_STYLES[approval.risk])}>
                      {approval.risk}
                    </span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{approval.detail}</div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{approval.eta}</span>
                    <span>{formatTimeAgo(approval.createdAt)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => triggerAction({ action: "approval:resolve", approvalId: approval.id, decision: "approved" })}
                      disabled={pendingAction || pendingMessage}
                      className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => triggerAction({ action: "approval:resolve", approvalId: approval.id, decision: "rejected" })}
                      disabled={pendingAction || pendingMessage}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {pendingApprovals.length === 0 ? (
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 p-4 text-sm text-emerald-100">
                  No held actions right now. Sensitive actions have been cleared or not requested yet.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-950/40 p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Workflow engine</div>
            <div className="mt-2 text-lg font-semibold text-white">Scheduled playbooks</div>
            <div className="mt-4 space-y-3">
              {state.workflows.map((workflow) => (
                <div key={workflow.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white">{workflow.name}</div>
                    <span className={classNames("rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em]", WORKFLOW_STYLES[workflow.status])}>
                      {workflow.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{workflow.cadence}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{workflow.destination}</div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Last run: {formatTimeAgo(workflow.lastRunAt)}</span>
                    <button
                      onClick={() => triggerAction({ action: "workflow:run", workflowId: workflow.id })}
                      disabled={pendingAction || pendingMessage}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Run now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-950/40 p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Local audit trail</div>
            <div className="mt-4 space-y-3">
              {state.auditEvents.slice(0, 5).map((event) => (
                <div key={event.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-sky-200">{event.category}</div>
                    <div className="text-xs text-slate-500">{formatTimeAgo(event.createdAt)}</div>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{event.summary}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
