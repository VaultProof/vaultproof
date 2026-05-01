export type AssistantMode = "chief_of_staff" | "revenue" | "board";

export type MessageRole = "user" | "assistant" | "system";

export interface AssistantProfile {
  id: AssistantMode;
  label: string;
  tone: string;
  promise: string;
}

export interface AssistantMessage {
  id: string;
  role: MessageRole;
  body: string;
  createdAt: string;
}

export interface Artifact {
  title: string;
  summary: string;
  bullets: string[];
  updatedAt: string;
}

export interface AssistantSession {
  assistantId: AssistantMode;
  messages: AssistantMessage[];
  artifact: Artifact;
}

export interface ApprovalItem {
  id: string;
  assistantId: AssistantMode;
  title: string;
  detail: string;
  risk: "low" | "medium" | "high";
  eta: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowItem {
  id: string;
  assistantId: AssistantMode;
  name: string;
  cadence: string;
  destination: string;
  status: "healthy" | "watch" | "draft";
  lastRunAt: string | null;
}

export interface ToolEvent {
  id: string;
  tool: string;
  summary: string;
  status: "ok" | "held";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  category: "chat" | "artifact" | "approval" | "workflow";
  summary: string;
  createdAt: string;
}

export interface ExecutiveStateSnapshot {
  profiles: AssistantProfile[];
  sessions: Record<AssistantMode, AssistantSession>;
  approvals: ApprovalItem[];
  workflows: WorkflowItem[];
  toolEvents: ToolEvent[];
  auditEvents: AuditEvent[];
}

type ExecutiveAction =
  | { action: "chat"; assistantId: AssistantMode; body: string }
  | { action: "artifact"; assistantId: AssistantMode }
  | { action: "approval:create"; assistantId: AssistantMode }
  | { action: "approval:resolve"; approvalId: string; decision: "approved" | "rejected" }
  | { action: "workflow:run"; workflowId: string };

interface InternalExecutiveState extends ExecutiveStateSnapshot {
  nextId: number;
}

const PROFILES: AssistantProfile[] = [
  {
    id: "chief_of_staff",
    label: "Chief of Staff",
    tone: "Cross-functional operator",
    promise: "Runs the executive day: prep, follow-ups, drafting, and approvals without losing governance.",
  },
  {
    id: "revenue",
    label: "Revenue Watch",
    tone: "Pipeline + risk analyst",
    promise: "Summarizes revenue movement, expansion signals, stalled deals, and accounts that need executive air cover.",
  },
  {
    id: "board",
    label: "Board Prep",
    tone: "Narrative and diligence editor",
    promise: "Turns raw metrics, customer movement, and operating notes into board-ready memos and decision packages.",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeArtifact(assistantId: AssistantMode, updatedAt = nowIso()): Artifact {
  if (assistantId === "revenue") {
    return {
      title: "Pipeline Escalation Slate",
      summary: "The largest near-term risk is not top-of-funnel. It is slow legal movement inside existing enterprise opportunities.",
      bullets: [
        "Acme renewal slipped 9 days because procurement still lacks the audit export packet.",
        "Two greenfield deals look healthy but still lack executive sponsor mapping.",
        "Mercer should move to founder outreach instead of SDR cadence.",
      ],
      updatedAt,
    };
  }

  if (assistantId === "board") {
    return {
      title: "Board Memo / Draft 3",
      summary: "Lead with governance and secure execution, then use traction as proof instead of opening with feature count.",
      bullets: [
        "Open with trust boundaries and why they matter for enterprise AI deployment.",
        "Use customer pull as evidence, not as the narrative lead.",
        "Tighten the ask so it reads like scale capital, not experimentation capital.",
      ],
      updatedAt,
    };
  }

  return {
    title: "Morning Brief / CEO",
    summary: "Three decisions need attention before noon: board deck edits, pricing exception approval, and a renewal risk signal from the enterprise pipeline.",
    bullets: [
      "Board prep: legal wants one line tightened before circulation.",
      "Revenue: two six-figure renewals are blocked on security language.",
      "Ops: hiring sync moved, but the briefing still assumes the old interview panel.",
    ],
    updatedAt,
  };
}

function seedMessages(assistantId: AssistantMode): AssistantMessage[] {
  const createdAt = nowIso();
  if (assistantId === "revenue") {
    return [
      { id: "seed-r-1", role: "system", body: "Assistant loaded pipeline movement, expansion signals, deal notes, and approvals that touch customer communications.", createdAt },
      { id: "seed-r-2", role: "user", body: "Which accounts actually deserve executive attention this week?", createdAt },
      { id: "seed-r-3", role: "assistant", body: "Focus on Acme, Union Grid, and Mercer. Acme is blocked on security diligence, Union Grid needs senior reassurance after the architecture review, and Mercer is healthy but missing sponsorship from finance leadership.", createdAt },
    ];
  }

  if (assistantId === "board") {
    return [
      { id: "seed-b-1", role: "system", body: "Assistant loaded the draft memo, board deck edits, operating metrics, and audit-safe product positioning notes.", createdAt },
      { id: "seed-b-2", role: "user", body: "Where is the current story weak?", createdAt },
      { id: "seed-b-3", role: "assistant", body: "The current memo opens too feature-first. The stronger story is that VaultProof owns the governance layer for AI actions, then proves it with enterprise traction and secure runtime architecture.", createdAt },
    ];
  }

  return [
    { id: "seed-c-1", role: "system", body: "Assistant loaded board notes, calendar, CRM deltas, approval queue, and organization policy context.", createdAt },
    { id: "seed-c-2", role: "user", body: "Give me the shortest possible read on what actually matters before noon.", createdAt },
    { id: "seed-c-3", role: "assistant", body: "Three items matter. First, legal wording in the board follow-up needs your approval before the 10:30 send. Second, the Acme renewal needs executive escalation because procurement is delaying security review. Third, hiring prep is out of sync with the updated calendar and should be regenerated.", createdAt },
  ];
}

function initialState(): InternalExecutiveState {
  const createdAt = nowIso();
  return {
    nextId: 100,
    profiles: clone(PROFILES),
    sessions: {
      chief_of_staff: {
        assistantId: "chief_of_staff",
        messages: seedMessages("chief_of_staff"),
        artifact: makeArtifact("chief_of_staff", createdAt),
      },
      revenue: {
        assistantId: "revenue",
        messages: seedMessages("revenue"),
        artifact: makeArtifact("revenue", createdAt),
      },
      board: {
        assistantId: "board",
        messages: seedMessages("board"),
        artifact: makeArtifact("board", createdAt),
      },
    },
    approvals: [
      {
        id: "approval-1",
        assistantId: "board",
        title: "Send board follow-up email",
        detail: "Draft is ready for 9 recipients. Contains financing timeline language and two customer names.",
        risk: "high",
        eta: "Needs review in 18m",
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "approval-2",
        assistantId: "revenue",
        title: "Approve CRM update for Acme renewal",
        detail: "Moves the account to executive assist mode and logs legal risk note from this morning.",
        risk: "medium",
        eta: "Queued by Revenue Watch",
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "approval-3",
        assistantId: "chief_of_staff",
        title: "Schedule customer debrief",
        detail: "Assistant found the earliest joint slot across three calendars and wants to send the hold.",
        risk: "low",
        eta: "Drafted 7m ago",
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    workflows: [
      {
        id: "wf-1",
        assistantId: "chief_of_staff",
        name: "Daily executive briefing",
        cadence: "Weekdays · 6:45 AM",
        destination: "Portal inbox + email draft",
        status: "healthy",
        lastRunAt: null,
      },
      {
        id: "wf-2",
        assistantId: "chief_of_staff",
        name: "Pre-meeting dossier",
        cadence: "60m before external meetings",
        destination: "Artifacts panel",
        status: "healthy",
        lastRunAt: null,
      },
      {
        id: "wf-3",
        assistantId: "revenue",
        name: "Weekly customer risk digest",
        cadence: "Fridays · 4:00 PM",
        destination: "Revenue Watch",
        status: "watch",
        lastRunAt: null,
      },
      {
        id: "wf-4",
        assistantId: "board",
        name: "Board packet compiler",
        cadence: "Manual kickoff",
        destination: "Board Prep workspace",
        status: "draft",
        lastRunAt: null,
      },
    ],
    toolEvents: [
      {
        id: "tool-1",
        tool: "docs.search",
        summary: "Loaded board notes, diligence packet, and decision log into Board Prep.",
        status: "ok",
        createdAt,
      },
      {
        id: "tool-2",
        tool: "calendar.read",
        summary: "Pulled today’s executive calendar to rebuild the morning brief.",
        status: "ok",
        createdAt,
      },
    ],
    auditEvents: [
      {
        id: "audit-1",
        category: "workflow",
        summary: "Local MVP initialized with three assistants, four workflows, and three held approvals.",
        createdAt,
      },
    ],
  };
}

declare global {
  var __vaultproofExecutiveMvp: InternalExecutiveState | undefined;
}

function getState(): InternalExecutiveState {
  if (!globalThis.__vaultproofExecutiveMvp) {
    globalThis.__vaultproofExecutiveMvp = initialState();
  }
  return globalThis.__vaultproofExecutiveMvp;
}

function nextId(prefix: string) {
  const state = getState();
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

function pushToolEvent(tool: string, summary: string, status: ToolEvent["status"]) {
  const state = getState();
  state.toolEvents.unshift({
    id: nextId("tool"),
    tool,
    summary,
    status,
    createdAt: nowIso(),
  });
  state.toolEvents = state.toolEvents.slice(0, 8);
}

function pushAuditEvent(category: AuditEvent["category"], summary: string) {
  const state = getState();
  state.auditEvents.unshift({
    id: nextId("audit"),
    category,
    summary,
    createdAt: nowIso(),
  });
  state.auditEvents = state.auditEvents.slice(0, 10);
}

function pushMessage(assistantId: AssistantMode, role: MessageRole, body: string) {
  const state = getState();
  state.sessions[assistantId].messages.push({
    id: nextId("msg"),
    role,
    body,
    createdAt: nowIso(),
  });
}

function replyForAssistant(assistantId: AssistantMode, body: string) {
  const normalized = body.toLowerCase();

  if (assistantId === "chief_of_staff") {
    if (normalized.includes("email") || normalized.includes("send")) {
      return "I can draft that and hold it behind approval. The likely right move is to keep the note short, confirm the decision needed, and avoid expanding the recipient list until the financing language is final.";
    }
    if (normalized.includes("brief") || normalized.includes("today") || normalized.includes("morning")) {
      return "The updated brief is tighter than before noon: financing language, the Acme renewal risk, and interview schedule drift are still the only issues that deserve your attention right now.";
    }
    return "The fastest path is to turn that into a concrete work product: memo, approval packet, or follow-up plan. I can generate the artifact and queue any external action behind review.";
  }

  if (assistantId === "revenue") {
    if (normalized.includes("renewal") || normalized.includes("deal") || normalized.includes("pipeline")) {
      return "The pattern is not lack of demand, it is friction in enterprise trust review. We should escalate with security proof points, not generic follow-up pressure.";
    }
    if (normalized.includes("who") || normalized.includes("accounts")) {
      return "Acme, Union Grid, and Mercer remain the right escalation set. Acme is a procurement drag, Union Grid needs reassurance, and Mercer needs sponsor mapping.";
    }
    return "I’d treat this as an escalation design problem: which accounts need executive air cover, what signal do we use, and which follow-up should be held for approval first.";
  }

  if (normalized.includes("memo") || normalized.includes("board") || normalized.includes("story")) {
    return "The board story gets stronger when we lead with governance, secure execution, and why that trust layer is hard to copy. The current memo should compress feature detail and widen the strategic framing.";
  }
  return "The right board artifact here is a tighter narrative and a cleaner decision request. I can regenerate the memo draft with a stronger through-line and push the resulting email or deck changes into approval.";
}

function ensureArtifact(assistantId: AssistantMode) {
  const state = getState();
  state.sessions[assistantId].artifact = makeArtifact(assistantId, nowIso());
}

function createApprovalForAssistant(assistantId: AssistantMode) {
  const state = getState();
  const duplicate = state.approvals.find(
    (approval) => approval.assistantId === assistantId && approval.status === "pending",
  );
  if (duplicate) {
    return duplicate;
  }

  const createdAt = nowIso();
  let title = "Review outbound action";
  let detail = "Assistant prepared an external action and held it behind approval.";
  let risk: ApprovalItem["risk"] = "medium";
  let eta = "Queued now";

  if (assistantId === "chief_of_staff") {
    title = "Approve executive follow-up draft";
    detail = "Chief of Staff prepared an executive follow-up email that references financing timing and customer names.";
    risk = "high";
    eta = "Needs review before send";
  } else if (assistantId === "revenue") {
    title = "Approve revenue escalation note";
    detail = "Revenue Watch prepared a CRM escalation note and optional founder outreach draft for the current risk set.";
    risk = "medium";
    eta = "Queued by Revenue Watch";
  } else if (assistantId === "board") {
    title = "Approve board packet circulation";
    detail = "Board Prep packaged the updated memo and wants approval before circulating the draft externally.";
    risk = "high";
    eta = "Waiting on narrative review";
  }

  const approval: ApprovalItem = {
    id: nextId("approval"),
    assistantId,
    title,
    detail,
    risk,
    eta,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  };
  state.approvals.unshift(approval);
  return approval;
}

export function getExecutiveSnapshot(): ExecutiveStateSnapshot {
  const state = getState();
  return clone({
    profiles: state.profiles,
    sessions: state.sessions,
    approvals: state.approvals,
    workflows: state.workflows,
    toolEvents: state.toolEvents,
    auditEvents: state.auditEvents,
  });
}

export function dispatchExecutiveAction(input: ExecutiveAction): ExecutiveStateSnapshot {
  const state = getState();

  if (input.action === "chat") {
    const body = input.body.trim();
    if (!body) return getExecutiveSnapshot();

    pushMessage(input.assistantId, "user", body);
    pushToolEvent("assistant.session", `Processed message in ${PROFILES.find((profile) => profile.id === input.assistantId)?.label || "assistant"}.`, "ok");

    if (body.toLowerCase().includes("artifact") || body.toLowerCase().includes("memo") || body.toLowerCase().includes("brief")) {
      ensureArtifact(input.assistantId);
      pushToolEvent("artifact.generate", `Regenerated ${state.sessions[input.assistantId].artifact.title}.`, "ok");
    }

    if (body.toLowerCase().includes("approve") || body.toLowerCase().includes("send") || body.toLowerCase().includes("email")) {
      const approval = createApprovalForAssistant(input.assistantId);
      pushToolEvent("approval.queue", `Held action "${approval.title}" for human review.`, "held");
    }

    pushMessage(input.assistantId, "assistant", replyForAssistant(input.assistantId, body));
    pushAuditEvent("chat", `${PROFILES.find((profile) => profile.id === input.assistantId)?.label || "Assistant"} processed a local chat turn.`);
    return getExecutiveSnapshot();
  }

  if (input.action === "artifact") {
    ensureArtifact(input.assistantId);
    pushMessage(input.assistantId, "system", `Artifact regenerated at ${new Date().toLocaleTimeString()}.`);
    pushToolEvent("artifact.generate", `Generated ${state.sessions[input.assistantId].artifact.title}.`, "ok");
    pushAuditEvent("artifact", `${state.sessions[input.assistantId].artifact.title} was regenerated locally.`);
    return getExecutiveSnapshot();
  }

  if (input.action === "approval:create") {
    const approval = createApprovalForAssistant(input.assistantId);
    pushMessage(input.assistantId, "system", `Queued "${approval.title}" behind an approval gate.`);
    pushToolEvent("approval.queue", `Queued "${approval.title}" for review.`, "held");
    pushAuditEvent("approval", `${approval.title} was queued for review.`);
    return getExecutiveSnapshot();
  }

  if (input.action === "approval:resolve") {
    const approval = state.approvals.find((item) => item.id === input.approvalId);
    if (!approval) {
      return getExecutiveSnapshot();
    }

    approval.status = input.decision;
    approval.updatedAt = nowIso();
    pushMessage(
      approval.assistantId,
      "system",
      `${approval.title} was ${input.decision}.`,
    );
    pushToolEvent("approval.resolve", `${approval.title} was ${input.decision}.`, "ok");
    pushAuditEvent("approval", `${approval.title} was ${input.decision} in the local MVP.`);
    return getExecutiveSnapshot();
  }

  const workflow = state.workflows.find((item) => item.id === input.workflowId);
  if (!workflow) {
    return getExecutiveSnapshot();
  }

  workflow.lastRunAt = nowIso();
  if (workflow.status === "draft") {
    workflow.status = "healthy";
  }
  ensureArtifact(workflow.assistantId);
  pushMessage(
    workflow.assistantId,
    "assistant",
    `${workflow.name} just ran locally. I refreshed the artifact and updated the workspace with the latest summary.`,
  );
  pushToolEvent("workflow.run", `${workflow.name} ran ${timeAgo(workflow.lastRunAt)} ago and refreshed ${state.sessions[workflow.assistantId].artifact.title}.`, "ok");
  pushAuditEvent("workflow", `${workflow.name} ran locally through the MVP workflow engine.`);
  return getExecutiveSnapshot();
}
