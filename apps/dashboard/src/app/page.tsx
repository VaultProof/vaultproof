"use client";

import { AppShell } from "../components/app-shell";
import { ExecutivePortalShell } from "../components/executive-portal-shell";

export default function ExecutivePage() {
  return (
    <AppShell
      eyebrow="Enterprise dashboard"
      title="Runtime, access, and evidence."
      description="Monitor the provisioned organization workspace: confidential runtime posture, provider slots, team access, access evidence, alerts, and daily operating signals."
    >
      <ExecutivePortalShell />
    </AppShell>
  );
}
