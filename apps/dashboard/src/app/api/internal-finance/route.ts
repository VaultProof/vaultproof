import { NextResponse } from "next/server";
import { dispatchInternalFinanceAction, getInternalFinanceSnapshot } from "../../../lib/internal-finance";
import { noStoreJson, requireInternalDashboardUser } from "../../../lib/server-auth";

export async function GET(request: Request) {
  const auth = await requireInternalDashboardUser(request);
  if (auth.error) return auth.error;

  return noStoreJson({ finance: getInternalFinanceSnapshot() });
}

export async function POST(request: Request) {
  const auth = await requireInternalDashboardUser(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid internal finance action." }, { status: 400 });
  }

  if (body.action === "scenario") {
    if (typeof body.scenarioId !== "string") {
      return NextResponse.json({ error: "Scenario actions require scenarioId." }, { status: 400 });
    }
    return noStoreJson({
      finance: dispatchInternalFinanceAction({ action: "scenario", scenarioId: body.scenarioId }),
    });
  }

  if (body.action === "review") {
    return noStoreJson({
      finance: dispatchInternalFinanceAction({ action: "review" }),
    });
  }

  return NextResponse.json({ error: "Unsupported internal finance action." }, { status: 400 });
}
