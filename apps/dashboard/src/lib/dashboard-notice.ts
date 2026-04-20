export const DASHBOARD_NOTICE_KEY = "vaultproof:dashboard-notice";

export interface DashboardNotice {
  type: "success" | "warning" | "info";
  message: string;
}

export function setDashboardNotice(notice: DashboardNotice): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DASHBOARD_NOTICE_KEY, JSON.stringify(notice));
}

export function consumeDashboardNotice(): DashboardNotice | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(DASHBOARD_NOTICE_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(DASHBOARD_NOTICE_KEY);

  try {
    return JSON.parse(raw) as DashboardNotice;
  } catch {
    return null;
  }
}
