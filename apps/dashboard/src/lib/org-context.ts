export const ORG_STORAGE_KEY = "vaultproof:selected-organization";
export const ORG_EVENT_NAME = "vaultproof:organization-changed";

export function getSelectedOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

export function setSelectedOrganizationId(organizationId: string | null): void {
  if (typeof window === "undefined") return;
  if (organizationId) {
    window.localStorage.setItem(ORG_STORAGE_KEY, organizationId);
  } else {
    window.localStorage.removeItem(ORG_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(ORG_EVENT_NAME, { detail: { organizationId } }));
}

export function getOrganizationHeaders(token: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const organizationId = getSelectedOrganizationId();
  if (organizationId) {
    headers["x-vaultproof-organization"] = organizationId;
  }
  return headers;
}
