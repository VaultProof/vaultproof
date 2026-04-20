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

interface AlertDestination {
  id: string;
  channel_type: "email" | "webhook";
  label: string;
  target_masked: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface AlertsResponse {
  organization: {
    id: string;
    name: string;
    kind: "personal" | "team";
    current_role: "owner" | "admin" | "member" | "viewer";
  } | null;
  can_manage: boolean;
  policy: {
    dispatch_enabled: boolean;
    minimum_severity: "info" | "warning" | "critical";
    min_interval_minutes: number;
  };
  dispatch_status: {
    last_policy_dispatch_at: string | null;
    next_eligible_at: string | null;
    cooldown_active: boolean;
  };
  destinations: AlertDestination[];
  delivery_logs: Array<{
    id: string;
    destination_id: string;
    channel_type: "email" | "webhook";
    delivery_kind: "test_send" | "policy_dispatch";
    status: "delivered" | "failed" | "skipped";
    detail: string;
    response_status: number | null;
    delivered_at: string;
  }>;
  delivery_logs_meta: {
    total: number;
    limit: number;
    has_more: boolean;
    next_before: string | null;
    filters: {
      activity_window: "all" | "24h" | "7d" | "30d";
      status: "all" | "delivered" | "failed" | "skipped";
      channel_type: "all" | "email" | "webhook";
      delivery_kind: "all" | "test_send" | "policy_dispatch";
      q: string | null;
    };
  };
  dispatch_runs: Array<{
    id: string;
    trigger_source: "manual" | "scheduled";
    status: "dispatched" | "skipped" | "failed";
    reason: string | null;
    dispatched_alert_count: number;
    destination_count: number;
    delivered_count: number;
    failed_count: number;
    skipped_count: number;
    next_eligible_at: string | null;
    checked_at: string;
  }>;
  dispatch_runs_meta: {
    total: number;
    limit: number;
    has_more: boolean;
    next_before: string | null;
    filters: {
      activity_window: "all" | "24h" | "7d" | "30d";
      status: "all" | "dispatched" | "skipped" | "failed";
      trigger_source: "all" | "manual" | "scheduled";
      q: string | null;
    };
  };
}

interface OverviewStats {
  totalCalls: number;
  errorCalls: number;
  deniedCalls: number;
  errorRate: number;
  providers: string[];
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
  } | null;
}

const ALERT_STYLES: Record<NonNullable<OverviewStats["alerts"]>[number]["severity"], string> = {
  critical: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  info: "border-sky-300/20 bg-sky-300/10 text-sky-100",
};

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
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function slugifyFilePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "vaultproof";
}

export default function AlertsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [alertsData, setAlertsData] = useState<AlertsResponse | null>(null);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [channelType, setChannelType] = useState<"email" | "webhook">("email");
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [dispatchEnabled, setDispatchEnabled] = useState(false);
  const [minimumSeverity, setMinimumSeverity] = useState<"info" | "warning" | "critical">("warning");
  const [minIntervalMinutes, setMinIntervalMinutes] = useState("60");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<"all" | "delivered" | "failed" | "skipped">("all");
  const [deliveryChannelFilter, setDeliveryChannelFilter] = useState<"all" | "email" | "webhook">("all");
  const [deliveryKindFilter, setDeliveryKindFilter] = useState<"all" | "test_send" | "policy_dispatch">("all");
  const [activityWindow, setActivityWindow] = useState<"all" | "24h" | "7d" | "30d">("7d");
  const [deliverySearch, setDeliverySearch] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState<"all" | "dispatched" | "skipped" | "failed">("all");
  const [runTriggerFilter, setRunTriggerFilter] = useState<"all" | "manual" | "scheduled">("all");
  const [runSearch, setRunSearch] = useState("");
  const [debouncedDeliverySearch, setDebouncedDeliverySearch] = useState("");
  const [debouncedRunSearch, setDebouncedRunSearch] = useState("");
  const [loadingMoreDeliveries, setLoadingMoreDeliveries] = useState(false);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);

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

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedDeliverySearch(deliverySearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [deliverySearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedRunSearch(runSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [runSearch]);

  const fetchData = useCallback(async (
    options?: {
      appendDeliveries?: boolean;
      appendRuns?: boolean;
      deliveryBefore?: string | null;
      runBefore?: string | null;
    },
  ) => {
    if (!token) return;
    const appendDeliveries = options?.appendDeliveries ?? false;
    const appendRuns = options?.appendRuns ?? false;
    const deliveryBefore = options?.deliveryBefore ?? null;
    const runBefore = options?.runBefore ?? null;

    if (!appendDeliveries && !appendRuns) {
      setLoading(true);
    }
    if (appendDeliveries) setLoadingMoreDeliveries(true);
    if (appendRuns) setLoadingMoreRuns(true);
    setError(null);

    try {
      const headers = getOrganizationHeaders(token);
      const params = new URLSearchParams({
        activity_window: activityWindow,
        delivery_status: deliveryStatusFilter,
        delivery_channel: deliveryChannelFilter,
        delivery_kind: deliveryKindFilter,
        delivery_q: debouncedDeliverySearch,
        run_status: runStatusFilter,
        run_trigger: runTriggerFilter,
        run_q: debouncedRunSearch,
      });
      if (deliveryBefore) params.set("delivery_before", deliveryBefore);
      if (runBefore) params.set("run_before", runBefore);
      const [destinationsResponse, overviewResponse] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/init/alerts?${params.toString()}`, { headers }),
        fetch(`${BACKEND_URL}/api/v1/init/projects/stats/overview`, { headers }),
      ]);

      const destinationsPayload = await destinationsResponse.json().catch(() => null);
      const overviewPayload = await overviewResponse.json().catch(() => null);

      if (!destinationsResponse.ok) {
        setError(destinationsPayload?.error || "Failed to load alert settings.");
        return;
      }
      if (!overviewResponse.ok) {
        setError(overviewPayload?.error || "Failed to load alert overview.");
        return;
      }

      setAlertsData((current) => {
        if (!current || (!appendDeliveries && !appendRuns)) {
          return destinationsPayload;
        }

        return {
          ...destinationsPayload,
          delivery_logs: appendDeliveries
            ? [...current.delivery_logs, ...(destinationsPayload?.delivery_logs || [])]
            : destinationsPayload?.delivery_logs || [],
          dispatch_runs: appendRuns
            ? [...current.dispatch_runs, ...(destinationsPayload?.dispatch_runs || [])]
            : destinationsPayload?.dispatch_runs || [],
        };
      });
      setOverview(overviewPayload);
      setDispatchEnabled(destinationsPayload?.policy?.dispatch_enabled ?? false);
      setMinimumSeverity(destinationsPayload?.policy?.minimum_severity ?? "warning");
      setMinIntervalMinutes(String(destinationsPayload?.policy?.min_interval_minutes ?? 60));
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      if (!appendDeliveries && !appendRuns) {
        setLoading(false);
      }
      if (appendDeliveries) setLoadingMoreDeliveries(false);
      if (appendRuns) setLoadingMoreRuns(false);
    }
  }, [
    activityWindow,
    debouncedDeliverySearch,
    debouncedRunSearch,
    deliveryChannelFilter,
    deliveryKindFilter,
    deliveryStatusFilter,
    runStatusFilter,
    runTriggerFilter,
    token,
  ]);

  useEffect(() => {
    if (token) void fetchData();
  }, [fetchData, token]);

  useEffect(() => {
    const handleOrgChange = () => {
      if (token) void fetchData();
    };
    window.addEventListener(ORG_EVENT_NAME, handleOrgChange);
    return () => window.removeEventListener(ORG_EVENT_NAME, handleOrgChange);
  }, [fetchData, token]);

  const payloadPreview = useMemo(() => JSON.stringify({
    organization: alertsData?.organization,
    policy: alertsData?.policy,
    pilot_review: overview?.pilotReview,
    metrics: {
      total_calls: overview?.totalCalls ?? 0,
      denied_calls: overview?.deniedCalls ?? 0,
      error_calls: overview?.errorCalls ?? 0,
      error_rate: overview?.errorRate ?? 0,
      providers: overview?.providers ?? [],
    },
    alerts: overview?.alerts ?? [],
  }, null, 2), [alertsData, overview]);

  const filteredDeliveryLogs = useMemo(() => alertsData?.delivery_logs || [], [alertsData?.delivery_logs]);
  const filteredDispatchRuns = useMemo(() => alertsData?.dispatch_runs || [], [alertsData?.dispatch_runs]);

  const operationsReport = useMemo(() => {
    const lines = [
      "VaultProof Alert Operations Report",
      `Organization: ${alertsData?.organization?.name || "Unknown"}`,
      `Dispatch enabled: ${alertsData?.policy?.dispatch_enabled ? "yes" : "no"}`,
      `Minimum severity: ${alertsData?.policy?.minimum_severity || "warning"}`,
      `Minimum interval: ${alertsData?.policy?.min_interval_minutes ?? 60} minutes`,
      `Last policy dispatch: ${alertsData?.dispatch_status?.last_policy_dispatch_at || "never"}`,
      `Next eligible dispatch: ${alertsData?.dispatch_status?.next_eligible_at || "now"}`,
      `Cooldown active: ${alertsData?.dispatch_status?.cooldown_active ? "yes" : "no"}`,
      `Configured destinations: ${alertsData?.destinations?.length ?? 0}`,
      `Enabled destinations: ${(alertsData?.destinations || []).filter((item) => item.enabled).length}`,
      `Current alerts: ${overview?.alerts?.length ?? 0}`,
      `Total calls: ${overview?.totalCalls ?? 0}`,
      `Denied calls: ${overview?.deniedCalls ?? 0}`,
      `Error calls: ${overview?.errorCalls ?? 0}`,
      `Error rate: ${formatErrorRate(overview?.errorRate ?? 0)}`,
      "",
      "Recent dispatch runs:",
    ];

    lines.push(`Dispatch runs in current view: ${filteredDispatchRuns.length}`);
    lines.push(`Delivery logs in current view: ${filteredDeliveryLogs.length}`);
    lines.push("");
    lines.push("Applied filters:");
    lines.push(`- Activity window: ${activityWindow}`);
    lines.push(`- Run status: ${runStatusFilter}`);
    lines.push(`- Run trigger: ${runTriggerFilter}`);
    lines.push(`- Run search: ${runSearch.trim() || "none"}`);
    lines.push(`- Delivery status: ${deliveryStatusFilter}`);
    lines.push(`- Delivery channel: ${deliveryChannelFilter}`);
    lines.push(`- Delivery kind: ${deliveryKindFilter}`);
    lines.push(`- Delivery search: ${deliverySearch.trim() || "none"}`);
    lines.push("");
    lines.push("Recent dispatch runs:");

    for (const run of filteredDispatchRuns) {
      lines.push(
        `- ${run.checked_at} | ${run.trigger_source} | ${run.status} | alerts=${run.dispatched_alert_count} | destinations=${run.destination_count} | delivered=${run.delivered_count} | failed=${run.failed_count} | skipped=${run.skipped_count}${run.reason ? ` | reason=${run.reason}` : ""}`,
      );
    }

    lines.push("", "Recent delivery logs:");
    for (const log of filteredDeliveryLogs) {
      lines.push(
        `- ${log.delivered_at} | ${log.delivery_kind} | ${log.channel_type} | ${log.status}${log.response_status !== null ? ` | http=${log.response_status}` : ""} | ${log.detail}`,
      );
    }

    return lines.join("\n");
  }, [
    alertsData,
    activityWindow,
    deliveryChannelFilter,
    deliveryKindFilter,
    deliverySearch,
    deliveryStatusFilter,
    filteredDeliveryLogs,
    filteredDispatchRuns,
    overview,
    runSearch,
    runStatusFilter,
    runTriggerFilter,
  ]);

  const dispatchRunsCsv = useMemo(() => {
    const rows = [
      [
        "checked_at",
        "trigger_source",
        "status",
        "reason",
        "dispatched_alert_count",
        "destination_count",
        "delivered_count",
        "failed_count",
        "skipped_count",
        "next_eligible_at",
      ],
      ...filteredDispatchRuns.map((run) => [
        run.checked_at,
        run.trigger_source,
        run.status,
        run.reason || "",
        String(run.dispatched_alert_count),
        String(run.destination_count),
        String(run.delivered_count),
        String(run.failed_count),
        String(run.skipped_count),
        run.next_eligible_at || "",
      ]),
    ];

    return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
  }, [filteredDispatchRuns]);

  const deliveryLogsCsv = useMemo(() => {
    const rows = [
      [
        "delivered_at",
        "delivery_kind",
        "channel_type",
        "status",
        "response_status",
        "detail",
      ],
      ...filteredDeliveryLogs.map((log) => [
        log.delivered_at,
        log.delivery_kind,
        log.channel_type,
        log.status,
        log.response_status === null ? "" : String(log.response_status),
        log.detail,
      ]),
    ];

    return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
  }, [filteredDeliveryLogs]);

  const filteredJsonExport = useMemo(() => JSON.stringify({
    exported_at: new Date().toISOString(),
    export_scope: {
      activity_window: activityWindow,
      run_status: runStatusFilter,
      run_trigger: runTriggerFilter,
      run_search: runSearch.trim() || null,
      delivery_status: deliveryStatusFilter,
      delivery_channel: deliveryChannelFilter,
      delivery_kind: deliveryKindFilter,
      delivery_search: deliverySearch.trim() || null,
    },
    organization: alertsData?.organization ?? null,
    policy: alertsData?.policy ?? null,
    dispatch_status: alertsData?.dispatch_status ?? null,
    overview: {
      pilot_review: overview?.pilotReview ?? null,
      total_calls: overview?.totalCalls ?? 0,
      denied_calls: overview?.deniedCalls ?? 0,
      error_calls: overview?.errorCalls ?? 0,
      error_rate: overview?.errorRate ?? 0,
      providers: overview?.providers ?? [],
      active_alerts: overview?.alerts ?? [],
    },
    destinations: alertsData?.destinations ?? [],
    dispatch_runs: filteredDispatchRuns,
    delivery_logs: filteredDeliveryLogs,
  }, null, 2), [
    activityWindow,
    alertsData,
    deliveryChannelFilter,
    deliveryKindFilter,
    deliverySearch,
    deliveryStatusFilter,
    filteredDeliveryLogs,
    filteredDispatchRuns,
    overview,
    runSearch,
    runStatusFilter,
    runTriggerFilter,
  ]);

  async function createDestination() {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel_type: channelType,
          label,
          target,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to create alert destination.");
        return;
      }

      setLabel("");
      setTarget("");
      setMessage("Alert destination added.");
      await fetchData();
    } catch {
      setError("Network error while creating alert destination.");
    } finally {
      setSaving(false);
    }
  }

  async function savePolicy() {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts/policy`, {
        method: "PUT",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dispatch_enabled: dispatchEnabled,
          minimum_severity: minimumSeverity,
          min_interval_minutes: Number(minIntervalMinutes),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to update alert policy.");
        return;
      }

      setMessage("Alert policy updated.");
      await fetchData();
    } catch {
      setError("Network error while updating alert policy.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDestination(destinationId: string, updates: { label?: string; enabled?: boolean }) {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts/${destinationId}`, {
        method: "PUT",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to update alert destination.");
        return;
      }

      setMessage("Alert destination updated.");
      await fetchData();
    } catch {
      setError("Network error while updating alert destination.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDestination(destinationId: string) {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts/${destinationId}`, {
        method: "DELETE",
        headers: getOrganizationHeaders(token),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to remove alert destination.");
        return;
      }

      setMessage("Alert destination removed.");
      await fetchData();
    } catch {
      setError("Network error while removing alert destination.");
    } finally {
      setSaving(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
      window.setTimeout(() => setMessage(null), 2500);
    } catch {
      setError("Clipboard copy failed.");
      window.setTimeout(() => setError(null), 2500);
    }
  }

  function downloadTextFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded ${filename}.`);
    window.setTimeout(() => setMessage(null), 2500);
  }

  const exportBaseName = useMemo(() => {
    const orgPart = slugifyFilePart(alertsData?.organization?.name || "organization");
    return `${orgPart}-alerts`;
  }, [alertsData]);

  async function sendTestAlerts(destinationId?: string) {
    if (!token) return;
    setTestSending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts/test-send`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(destinationId ? { destination_id: destinationId } : {}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to send test alerts.");
        return;
      }

      const results = (payload?.results || []) as Array<{ status: string }>;
      const delivered = results.filter((result) => result.status === "delivered").length;
      const failed = results.filter((result) => result.status === "failed").length;
      const skipped = results.filter((result) => result.status === "skipped").length;
      setMessage(`Test send complete: ${delivered} delivered, ${failed} failed, ${skipped} skipped.`);
      await fetchData();
    } catch {
      setError("Network error while sending test alerts.");
    } finally {
      setTestSending(false);
    }
  }

  async function dispatchCurrentAlerts() {
    if (!token) return;
    setDispatching(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/init/alerts/dispatch-current`, {
        method: "POST",
        headers: {
          ...getOrganizationHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Failed to dispatch current alerts.");
        return;
      }

      if (payload?.skipped) {
        setMessage(payload?.reason || "No alerts met the current dispatch policy.");
      } else {
        const results = (payload?.results || []) as Array<{ status: string }>;
        const delivered = results.filter((result) => result.status === "delivered").length;
        const failed = results.filter((result) => result.status === "failed").length;
        const skipped = results.filter((result) => result.status === "skipped").length;
        setMessage(`Policy dispatch complete: ${delivered} delivered, ${failed} failed, ${skipped} skipped.`);
      }
      await fetchData();
    } catch {
      setError("Network error while dispatching alerts.");
    } finally {
      setDispatching(false);
    }
  }

  async function loadMoreDeliveries() {
    if (!alertsData?.delivery_logs_meta?.has_more || !alertsData.delivery_logs_meta.next_before) return;
    await fetchData({
      appendDeliveries: true,
      deliveryBefore: alertsData.delivery_logs_meta.next_before,
    });
  }

  async function loadMoreDispatchRuns() {
    if (!alertsData?.dispatch_runs_meta?.has_more || !alertsData.dispatch_runs_meta.next_before) return;
    await fetchData({
      appendRuns: true,
      runBefore: alertsData.dispatch_runs_meta.next_before,
    });
  }

  return (
    <AppShell
      eyebrow="Alert Delivery Foundation"
      title="Alerts"
      description="Set up where pilot and health alerts should go next. Email/webhook destinations, policy dispatch rules, and scheduled worker delivery now live behind this org-level alerting surface."
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
      {loading ? <div className="py-20 text-center text-slate-400">Loading alert delivery settings...</div> : null}
      {error && !loading ? (
        <div className="rounded-[26px] border border-red-500/20 bg-red-500/10 p-6 text-center text-red-300">{error}</div>
      ) : null}

      {!loading && !error ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Destinations</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">Where alerts should go next</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Teams can now register destinations, define dispatch policy, and let the worker&apos;s scheduled job reuse the same policy path automatically.
            </p>

            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Dispatch policy</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  This policy decides which current alerts are eligible for real dispatch. It gives us one stable rule set the future scheduler can call without reinventing delivery logic.
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                  <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={dispatchEnabled}
                      onChange={(event) => setDispatchEnabled(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950/70"
                    />
                    Enable policy dispatch
                  </label>
                  <select
                    value={minimumSeverity}
                    onChange={(event) => setMinimumSeverity(event.target.value as "info" | "warning" | "critical")}
                    className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="info">Info and above</option>
                    <option value="warning">Warning and above</option>
                    <option value="critical">Critical only</option>
                  </select>
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    step={5}
                    value={minIntervalMinutes}
                    onChange={(event) => setMinIntervalMinutes(event.target.value)}
                    placeholder="60"
                    className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void savePolicy()}
                    disabled={saving || !alertsData?.can_manage}
                    className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save Policy"}
                  </button>
                  <div className="text-sm text-slate-400">
                    Minimum interval controls the cooldown between policy dispatches for this organization.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Dispatch status</div>
                <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                  <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Last Policy Dispatch</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {alertsData?.dispatch_status?.last_policy_dispatch_at ? timeAgo(alertsData.dispatch_status.last_policy_dispatch_at) : "Never"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {alertsData?.dispatch_status?.last_policy_dispatch_at ? formatDateTime(alertsData.dispatch_status.last_policy_dispatch_at) : "No successful or attempted policy dispatch logged yet."}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Next Eligible Dispatch</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {alertsData?.dispatch_status?.next_eligible_at ? timeAgo(alertsData.dispatch_status.next_eligible_at) : "Now"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {alertsData?.dispatch_status?.next_eligible_at ? formatDateTime(alertsData.dispatch_status.next_eligible_at) : "No cooldown window is active yet."}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Cooldown</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {alertsData?.dispatch_status?.cooldown_active ? "Active" : "Clear"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {alertsData?.dispatch_status?.cooldown_active
                        ? "Policy dispatch will skip until the cooldown window ends."
                        : "Policy dispatch can run whenever alerts meet the current threshold."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <select
                  value={channelType}
                  onChange={(event) => setChannelType(event.target.value as "email" | "webhook")}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/35"
                >
                  <option value="email">Email</option>
                  <option value="webhook">Webhook</option>
                </select>
                <input
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Security inbox"
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                />
                <input
                  type={channelType === "email" ? "email" : "url"}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder={channelType === "email" ? "alerts@example.com" : "https://hooks.example.com/vaultproof"}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void createDestination()}
                  disabled={saving || !alertsData?.can_manage}
                  className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Add Destination"}
                </button>
                <div className="text-sm text-slate-400">
                  {alertsData?.can_manage
                    ? "Destinations are live, and scheduled worker dispatch now reuses the same policy path."
                    : "Owner or admin role required to manage destinations."}
                </div>
                {alertsData?.can_manage ? (
                  <button
                    onClick={() => void sendTestAlerts()}
                    disabled={testSending || (alertsData?.destinations || []).filter((item) => item.enabled).length === 0}
                    className="rounded-2xl border border-sky-300/20 px-5 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testSending ? "Sending..." : "Send Test Alerts"}
                  </button>
                ) : null}
                {alertsData?.can_manage ? (
                  <button
                    onClick={() => void dispatchCurrentAlerts()}
                    disabled={dispatching || !dispatchEnabled || (alertsData?.destinations || []).filter((item) => item.enabled).length === 0}
                    className="rounded-2xl border border-amber-300/20 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {dispatching ? "Dispatching..." : "Dispatch Current Alerts"}
                  </button>
                ) : null}
              </div>
              {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
            </div>

            <div className="mt-6 space-y-4">
              {(alertsData?.destinations || []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  No alert destinations configured yet.
                </div>
              ) : (
                alertsData?.destinations.map((destination) => (
                  <div key={destination.id} className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{destination.label}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{destination.channel_type}</div>
                      </div>
                      <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${destination.enabled ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
                        {destination.enabled ? "enabled" : "disabled"}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-300">{destination.target_masked}</div>
                    <div className="mt-2 text-xs text-slate-500">Updated {timeAgo(destination.updated_at)}</div>
                    {alertsData?.can_manage ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          onClick={() => void sendTestAlerts(destination.id)}
                          disabled={saving || testSending || !destination.enabled}
                          className="rounded-xl border border-sky-300/20 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {testSending ? "Sending..." : "Test Send"}
                        </button>
                        <button
                          onClick={() => void updateDestination(destination.id, { enabled: !destination.enabled })}
                          disabled={saving}
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {destination.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => void deleteDestination(destination.id)}
                          disabled={saving}
                          className="rounded-xl border border-rose-400/20 px-3 py-2 text-xs text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[26px] border border-white/8 bg-white/[0.04] p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Preview</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">What we would deliver</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              The worker already knows the current pilot status and active health alerts. This preview makes the outbound shape explicit for both manual test sends and scheduled policy dispatch.
            </p>

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Pilot status</div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold text-white">{overview?.pilotReview?.headline || "No pilot summary yet"}</div>
                  <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                    {titleCase(overview?.pilotReview?.status || "setup")}
                  </div>
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{overview?.pilotReview?.recommendation || "No recommendation yet."}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-white/6 bg-white/[0.03] p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Calls</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatCount(overview?.totalCalls ?? 0)}</div>
                  </div>
                  <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-amber-200">Denied</div>
                    <div className="mt-2 text-xl font-semibold text-amber-100">{formatCount(overview?.deniedCalls ?? 0)}</div>
                  </div>
                  <div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-rose-200">Error Rate</div>
                    <div className="mt-2 text-xl font-semibold text-rose-100">{formatErrorRate(overview?.errorRate ?? 0)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Active alerts</div>
                <div className="mt-3 space-y-3">
                  {(overview?.alerts || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No active alerts right now.
                    </div>
                  ) : (
                    (overview?.alerts || []).map((alert) => (
                      <div key={alert.id} className={`rounded-xl border p-3 ${ALERT_STYLES[alert.severity]}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{alert.title}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">{alert.severity}</div>
                        </div>
                        <div className="mt-2 text-sm leading-6">{alert.detail}</div>
                        {alert.project_name ? <div className="mt-2 text-xs text-white/75">Project: {alert.project_name}</div> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Sample webhook payload</div>
                  <button
                    onClick={() => void copyText(payloadPreview, "Sample alert payload copied.")}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                  >
                    Copy Payload
                  </button>
                </div>
                <textarea
                  readOnly
                  value={payloadPreview}
                  rows={Math.min(20, Math.max(12, payloadPreview.split("\n").length))}
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-6 text-slate-200 outline-none"
                />
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Operations export</div>
                    <div className="mt-1 text-sm text-slate-300">
                      Copy a compact operations report or CSV exports for alert reviews, security handoff, and incident follow-up.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void copyText(operationsReport, "Operations report copied.")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Copy Report
                    </button>
                    <button
                      onClick={() => downloadTextFile(operationsReport, `${exportBaseName}-operations-report.txt`, "text/plain;charset=utf-8")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Download Report
                    </button>
                    <button
                      onClick={() => void copyText(dispatchRunsCsv, "Dispatch runs CSV copied.")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Copy Runs CSV
                    </button>
                    <button
                      onClick={() => downloadTextFile(dispatchRunsCsv, `${exportBaseName}-dispatch-runs.csv`, "text/csv;charset=utf-8")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Download Runs CSV
                    </button>
                    <button
                      onClick={() => void copyText(deliveryLogsCsv, "Delivery logs CSV copied.")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Copy Delivery CSV
                    </button>
                    <button
                      onClick={() => downloadTextFile(deliveryLogsCsv, `${exportBaseName}-delivery-logs.csv`, "text/csv;charset=utf-8")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Download Delivery CSV
                    </button>
                    <button
                      onClick={() => void copyText(filteredJsonExport, "Filtered alert export JSON copied.")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Copy JSON
                    </button>
                    <button
                      onClick={() => downloadTextFile(filteredJsonExport, `${exportBaseName}-export.json`, "application/json;charset=utf-8")}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.04]"
                    >
                      Download JSON
                    </button>
                  </div>
                </div>
                <textarea
                  readOnly
                  value={operationsReport}
                  rows={Math.min(18, Math.max(10, operationsReport.split("\n").length))}
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-6 text-slate-200 outline-none"
                />
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Recent delivery log</div>
                <div className="mt-3">
                  <select
                    value={activityWindow}
                    onChange={(event) => setActivityWindow(event.target.value as "all" | "24h" | "7d" | "30d")}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35 md:w-auto"
                  >
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="all">All time</option>
                  </select>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <select
                    value={deliveryStatusFilter}
                    onChange={(event) => setDeliveryStatusFilter(event.target.value as "all" | "delivered" | "failed" | "skipped")}
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="all">All statuses</option>
                    <option value="delivered">Delivered</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                  </select>
                  <select
                    value={deliveryChannelFilter}
                    onChange={(event) => setDeliveryChannelFilter(event.target.value as "all" | "email" | "webhook")}
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="all">All channels</option>
                    <option value="email">Email</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <select
                    value={deliveryKindFilter}
                    onChange={(event) => setDeliveryKindFilter(event.target.value as "all" | "test_send" | "policy_dispatch")}
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="all">All kinds</option>
                    <option value="test_send">Test sends</option>
                    <option value="policy_dispatch">Policy dispatches</option>
                  </select>
                  <input
                    type="text"
                    value={deliverySearch}
                    onChange={(event) => setDeliverySearch(event.target.value)}
                    placeholder="Search detail or HTTP status"
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <div>
                    Showing {filteredDeliveryLogs.length} of {alertsData?.delivery_logs_meta?.total ?? filteredDeliveryLogs.length} delivery logs
                  </div>
                  {(activityWindow !== "7d" || deliveryStatusFilter !== "all" || deliveryChannelFilter !== "all" || deliveryKindFilter !== "all" || deliverySearch.trim()) ? (
                    <button
                      onClick={() => {
                        setActivityWindow("7d");
                        setDeliveryStatusFilter("all");
                        setDeliveryChannelFilter("all");
                        setDeliveryKindFilter("all");
                        setDeliverySearch("");
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/[0.04]"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-3">
                  {(alertsData?.delivery_logs || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No alert delivery attempts logged yet.
                    </div>
                  ) : filteredDeliveryLogs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No delivery logs match the current filters.
                    </div>
                  ) : (
                    filteredDeliveryLogs.map((log) => (
                      <div key={log.id} className={`rounded-xl border p-3 ${ALERT_STYLES[log.status === "failed" ? "critical" : log.status === "skipped" ? "warning" : "info"]}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{log.channel_type} {log.status}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">{timeAgo(log.delivered_at)}</div>
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/70">{log.delivery_kind.replace("_", " ")}</div>
                        <div className="mt-2 text-sm leading-6">{log.detail}</div>
                        {log.response_status !== null ? (
                          <div className="mt-2 text-xs text-white/75">HTTP status: {log.response_status}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                {alertsData?.delivery_logs_meta?.has_more ? (
                  <div className="mt-4">
                    <button
                      onClick={() => void loadMoreDeliveries()}
                      disabled={loadingMoreDeliveries}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMoreDeliveries ? "Loading..." : "Load More Delivery Logs"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/6 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">Recent dispatch runs</div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <select
                    value={runStatusFilter}
                    onChange={(event) => setRunStatusFilter(event.target.value as "all" | "dispatched" | "skipped" | "failed")}
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="all">All statuses</option>
                    <option value="dispatched">Dispatched</option>
                    <option value="skipped">Skipped</option>
                    <option value="failed">Failed</option>
                  </select>
                  <select
                    value={runTriggerFilter}
                    onChange={(event) => setRunTriggerFilter(event.target.value as "all" | "manual" | "scheduled")}
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/35"
                  >
                    <option value="all">All triggers</option>
                    <option value="manual">Manual</option>
                    <option value="scheduled">Scheduled</option>
                  </select>
                  <input
                    type="text"
                    value={runSearch}
                    onChange={(event) => setRunSearch(event.target.value)}
                    placeholder="Search reason or counts"
                    className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/35"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <div>
                    Showing {filteredDispatchRuns.length} of {alertsData?.dispatch_runs_meta?.total ?? filteredDispatchRuns.length} dispatch runs
                  </div>
                  {(activityWindow !== "7d" || runStatusFilter !== "all" || runTriggerFilter !== "all" || runSearch.trim()) ? (
                    <button
                      onClick={() => {
                        setActivityWindow("7d");
                        setRunStatusFilter("all");
                        setRunTriggerFilter("all");
                        setRunSearch("");
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/[0.04]"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-3">
                  {(alertsData?.dispatch_runs || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No dispatch runs logged yet.
                    </div>
                  ) : filteredDispatchRuns.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      No dispatch runs match the current filters.
                    </div>
                  ) : (
                    filteredDispatchRuns.map((run) => (
                      <div key={run.id} className={`rounded-xl border p-3 ${ALERT_STYLES[run.status === "failed" ? "critical" : run.status === "skipped" ? "warning" : "info"]}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{run.trigger_source} {run.status}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">{timeAgo(run.checked_at)}</div>
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
                          {formatDateTime(run.checked_at)}
                        </div>
                        {run.reason ? <div className="mt-2 text-sm leading-6">{run.reason}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/75">
                          <span>{run.dispatched_alert_count} alerts</span>
                          <span>{run.destination_count} destinations</span>
                          <span>{run.delivered_count} delivered</span>
                          <span>{run.failed_count} failed</span>
                          <span>{run.skipped_count} skipped</span>
                        </div>
                        {run.next_eligible_at ? (
                          <div className="mt-2 text-xs text-white/75">
                            Next eligible: {formatDateTime(run.next_eligible_at)}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                {alertsData?.dispatch_runs_meta?.has_more ? (
                  <div className="mt-4">
                    <button
                      onClick={() => void loadMoreDispatchRuns()}
                      disabled={loadingMoreRuns}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMoreRuns ? "Loading..." : "Load More Dispatch Runs"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
