"use client";

import { AppShell } from "../components/app-shell";
import { ExecutivePortalShell } from "../components/executive-portal-shell";

export default function ExecutivePage() {
  return (
    <AppShell
      eyebrow="Executive Portal Build"
      title="Executive"
      description="A VaultProof-owned chief of staff workspace that combines assistant chat, artifacts, approvals, and scheduled workflows inside the same enterprise control plane."
    >
      <ExecutivePortalShell />
    </AppShell>
  );
}
