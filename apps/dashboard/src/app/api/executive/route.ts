import { NextResponse } from "next/server";
import { dispatchExecutiveAction, getExecutiveSnapshot, type AssistantMode } from "../../../lib/executive-mvp";
import { noStoreJson, requireInternalDashboardUser } from "../../../lib/server-auth";

function isAssistantMode(value: unknown): value is AssistantMode {
  return value === "chief_of_staff" || value === "revenue" || value === "board";
}

export async function GET(request: Request) {
  const auth = await requireInternalDashboardUser(request);
  if (auth.error) return auth.error;

  return noStoreJson({ state: getExecutiveSnapshot() });
}

export async function POST(request: Request) {
  const auth = await requireInternalDashboardUser(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid executive action." }, { status: 400 });
  }

  if (body.action === "chat") {
    if (!isAssistantMode(body.assistantId) || typeof body.body !== "string") {
      return NextResponse.json({ error: "Chat actions require assistantId and body." }, { status: 400 });
    }
    return noStoreJson({
      state: dispatchExecutiveAction({ action: "chat", assistantId: body.assistantId, body: body.body }),
    });
  }

  if (body.action === "artifact") {
    if (!isAssistantMode(body.assistantId)) {
      return NextResponse.json({ error: "Artifact actions require assistantId." }, { status: 400 });
    }
    return noStoreJson({
      state: dispatchExecutiveAction({ action: "artifact", assistantId: body.assistantId }),
    });
  }

  if (body.action === "approval:create") {
    if (!isAssistantMode(body.assistantId)) {
      return NextResponse.json({ error: "Approval create actions require assistantId." }, { status: 400 });
    }
    return noStoreJson({
      state: dispatchExecutiveAction({ action: "approval:create", assistantId: body.assistantId }),
    });
  }

  if (body.action === "approval:resolve") {
    if (typeof body.approvalId !== "string" || (body.decision !== "approved" && body.decision !== "rejected")) {
      return NextResponse.json({ error: "Approval resolve actions require approvalId and decision." }, { status: 400 });
    }
    return noStoreJson({
      state: dispatchExecutiveAction({ action: "approval:resolve", approvalId: body.approvalId, decision: body.decision }),
    });
  }

  if (body.action === "workflow:run") {
    if (typeof body.workflowId !== "string") {
      return NextResponse.json({ error: "Workflow run actions require workflowId." }, { status: 400 });
    }
    return noStoreJson({
      state: dispatchExecutiveAction({ action: "workflow:run", workflowId: body.workflowId }),
    });
  }

  return NextResponse.json({ error: "Unsupported executive action." }, { status: 400 });
}
