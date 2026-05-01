# VaultProof Executive Agent Portal Build Plan

Status: active - research-backed source of truth
Owner: VaultProof product + enterprise
Last updated: 2026-04-27

## Why this file exists

We have enough context now to stop debating whether we should adopt one agent product wholesale.

This file defines the plan to build a VaultProof-hosted executive AI portal by combining the best patterns from leading open-source agent products while keeping VaultProof's security model, governance, and product polish as the real control plane.

Rules:

- Treat this file as the build source of truth for the executive assistant product line.
- Borrow product patterns from open-source agents; do not inherit their trust models blindly.
- Default to multi-user safety, approval gates, and auditability over raw autonomy.
- Build the user-facing portal in `apps/dashboard`.
- Keep `apps/site` focused on marketing, demos, and lightweight public entry points.
- Put policy, orchestration, and audit logic in server-side packages, not in the browser.

## Product thesis

We should not ship "OpenClaw but hosted" or "LibreChat but branded."

We should ship a VaultProof executive portal that is:

- safer than raw multi-user agent deployments
- more polished than developer-first open-source chat tools
- more proactive than standard chat apps
- more extensible than a fixed assistant
- easier to approve, monitor, and shut down than agent runtimes exposed directly to users

The product should feel like:

- an executive operating system
- a secure AI chief of staff
- a company knowledge and action layer

It should not feel like:

- a hobbyist agent console
- a developer terminal in a web wrapper
- a shared bot with unclear boundaries

## Research synthesis

### Decision

Build a custom VaultProof product layer and selectively adopt the strongest ideas from other agent systems.

Do not pick one open-source stack as the whole product.

### What to borrow

#### LibreChat

Use as the reference for:

- multi-user chat UX
- SSO-friendly product shape
- user-specific tool auth and MCP connections
- agent builder concepts
- memory controls that users can understand

Why:

- LibreChat's MCP design is explicitly built for multi-user environments with user-specific connections and credential isolation.
- LibreChat already demonstrates the right shape for a secure internal AI portal rather than a single-user agent shell.

Do not borrow:

- the assumption that the chat shell itself is the policy layer
- direct exposure of broad tool catalogs without VaultProof policy wrapping

#### OpenClaw

Use as the reference for:

- scheduled automation
- proactive follow-up behavior
- chat-channel delivery patterns
- long-running background agent turns

Why:

- OpenClaw is strong at turning an assistant into a persistent operator that can wake up later and deliver results.

Do not borrow:

- its default trust boundary for shared multi-user deployments
- the idea of one shared gateway for mutually untrusted users

Important constraint:

- OpenClaw's own security docs say it is a personal-assistant trust model and recommend separate gateways and ideally separate OS users or hosts when strong isolation is required.

#### Space Agent and Agent Zero patterns

Use as the reference for:

- browser-native workspace behavior
- modular skills based on `SKILL.md`
- project/workspace isolation concepts
- richer task UI than a plain chat transcript

Why:

- Space Agent's public positioning is browser-native and self-hostable for multi-user/group use.
- Agent Zero has already leaned hard into portable `SKILL.md` workflows, isolated projects, scheduling, and plugin-driven extensibility.

Do not borrow:

- plugin sprawl without review
- broad user-installed code execution in production

#### Dify

Use as the reference for:

- structured workflow and chatflow design
- admin-authored repeatable processes
- observability-aware app orchestration
- visual workflow concepts for internal operators

Why:

- Dify is excellent at converting brittle prompt behavior into explicit, repeatable flows with branching and tool steps.

Do not borrow:

- a low-code canvas as the main executive UX
- workflow sprawl without governance and versioning

#### OpenHands

Use as the reference for:

- isolated execution runtimes
- task sandboxing
- custom runtime images
- separation between orchestration and execution

Why:

- OpenHands documents a clear sandbox model where arbitrary code and file actions happen in an isolated runtime instead of on the host.

Do not borrow:

- exposing a general-purpose coding shell to executives by default
- local non-sandbox execution for high-trust workflows

#### Open WebUI

Use as the reference for:

- artifacts and side-by-side work product surfaces
- model wrappers and presets
- pluggable pipelines for heavyweight processing

Why:

- Open WebUI's artifacts pattern is a better executive experience than forcing everything into a linear chat transcript.
- Its split between in-app functions and heavier external pipelines is a good product architecture pattern.

Do not borrow:

- arbitrary Python functions installed from unreviewed sources
- admin convenience features that weaken production isolation

#### GitHub agent skills standard

Use as the reference for:

- portable `SKILL.md` conventions
- reusable workflow packaging
- skills as process, not just prompt text

Why:

- the open `SKILL.md` pattern is becoming a practical interoperability layer across agent ecosystems

Do not borrow:

- raw skill execution without VaultProof review, versioning, and policy metadata

## Strategic product decisions

### Decision 1: build a custom app, not a reskinned open-source UI

The executive portal should be a custom VaultProof product in `apps/dashboard`.

Reasons:

- we need a stronger trust model than OpenClaw's default shared setup
- we need more executive polish than raw agent products provide
- we need VaultProof-native policy, audit, approvals, and identity controls

### Decision 2: the policy layer must be ours

The central control plane must remain VaultProof-owned code.

That layer decides:

- who can access what
- what tools are available
- what actions need approval
- what memory is retained
- what data can leave the boundary
- what gets audited

### Decision 3: use specialized runtimes behind one product surface

The user should see one assistant.

Under the hood we should support multiple execution styles:

- interactive chat turns
- structured workflows
- scheduled jobs
- document generation
- browser automation
- sandboxed code execution

### Decision 4: per-user isolation is non-negotiable

For any tool-enabled or long-running agent behavior, use:

- one isolated runtime per user, or
- one isolated runtime per task/session for sensitive operations

Do not use one shared tool-enabled agent for the whole executive team.

## Target product surface

### Core user experiences

- daily briefing
- board and meeting prep
- email drafting with approval
- customer and account dossier generation
- company knowledge search
- delegated follow-up tasks
- calendar-aware action planning
- secure file and memo analysis

### Core admin experiences

- SSO and role mapping
- assistant catalog management
- tool policy management
- workflow publishing
- approval policy management
- audit and replay
- retention and data access controls
- emergency disable / kill switch

## System architecture

```text
user browser
  -> apps/dashboard
  -> VaultProof executive API / control plane
  -> policy engine + memory + audit + approval layer
  -> tool gateway / MCP gateway / workflow engine
  -> isolated execution runtimes
  -> external systems (email, calendar, CRM, docs, Slack, browser, code sandbox)
```

### Layer 1: executive web app

Primary home:

- `apps/dashboard`

Responsibilities:

- chat and workspace UX
- artifacts and work-product panes
- approvals inbox
- assistant picker
- settings and memory controls
- workflow launch surfaces
- audit views for authorized users

Borrowed patterns:

- LibreChat multi-user UX
- Open WebUI artifacts
- Space Agent browser-native workspace feel

### Layer 2: VaultProof control plane

Primary home:

- new routes and services in `packages/enterprise-control-plane`

Responsibilities:

- authenticated API for the executive portal
- org, role, and user policy enforcement
- conversation/session metadata
- memory orchestration
- approval state machine
- audit/event pipeline
- workflow registry
- skills registry
- model routing policy

This is the most important product boundary.

### Layer 3: tool gateway

Primary home:

- new package or submodule under `packages/enterprise-control-plane/src`
- optional dedicated package later if the surface grows fast

Responsibilities:

- wrap every external integration behind a typed policy layer
- map VaultProof users to user-scoped OAuth credentials
- enforce least privilege and approval requirements
- normalize tool results into consistent schemas
- expose tools over:
  - first-party RPC
  - MCP-compatible transport where useful

Initial tool families:

- Google Workspace or Microsoft 365
- Slack
- CRM
- company docs/wiki
- internal search
- meeting notes and recordings

### Layer 4: workflow engine

Responsibilities:

- deterministic multi-step flows
- admin-authored playbooks
- retry rules
- branching and fallbacks
- scheduled execution
- webhook or channel delivery

Borrowed patterns:

- Dify workflow/chatflow discipline
- OpenClaw cron and delayed execution

### Layer 5: isolated runtime layer

Primary home:

- extend `packages/enterprise-secure-executor` or create a sibling runtime package depending on trust requirements

Responsibilities:

- browser automation
- file transforms
- document generation
- code execution for narrow internal jobs
- long-running task execution

Runtime requirements:

- sandboxed container or VM isolation
- per-task or per-user boundaries
- resource limits
- short-lived credentials
- strict logging and redaction

Borrowed patterns:

- OpenHands runtime isolation
- Dify sandbox separation

### Layer 6: memory and knowledge layer

Responsibilities:

- personal memory
- work-context memory
- organization knowledge retrieval
- policy-aware retention

Memory types:

- personal memory: preferences, tone, recurring contacts
- work memory: current initiatives, follow-ups, project context
- company memory: approved retrieval over docs, CRM, wiki, notes

Rules:

- memory must be inspectable
- memory must be editable
- memory must be scoped
- memory must be disable-able by policy

### Layer 7: audit and approval layer

Responsibilities:

- full action log
- tool-call replay
- approval checkpoints
- action receipts
- export for compliance review

Approval triggers:

- sending email
- posting external messages
- editing CRM records
- scheduling on behalf of a user
- exporting sensitive files
- running broad browser actions

## What makes this better than the current open-source options

### Better than raw OpenClaw

- stronger multi-user isolation
- better executive-facing web experience
- less direct exposure of runtime trust boundaries
- clearer policy and approval model

### Better than raw LibreChat

- proactive scheduling and follow-up
- stronger enterprise action controls
- richer workflow engine
- more opinionated executive workflows

### Better than raw Dify

- better end-user UX for executives
- less builder-first, more assistant-first
- stronger per-user identity and approval model

### Better than raw Open WebUI

- stronger policy boundary than admin-installed functions
- better workflow and audit discipline
- cleaner multi-user governance

### Better than raw Space Agent / Agent Zero

- stronger enterprise trust model
- less plugin risk
- clearer governance over skills, tools, and data boundaries

## Repo mapping

### Existing surfaces to use

- `apps/dashboard`
  - executive portal UI
- `apps/site`
  - marketing, demo flows, and sales collateral
- `packages/enterprise-control-plane`
  - policy layer, API, audit, workflow registry, tool gateway
- `packages/enterprise-secure-executor`
  - high-trust execution and isolated runtime orchestration
- `packages/init-worker`
  - reusable policy and telemetry patterns where applicable

### Likely new surfaces

- `packages/executive-workflows`
  - workflow definitions, triggers, and schemas
- `packages/executive-skills`
  - `SKILL.md` registry, metadata, versioning, validation
- `packages/executive-tool-gateway`
  - if tool surface outgrows the control plane package
- `packages/executive-runtime`
  - if we want a dedicated isolated runtime separate from the current secure executor

## Build phases

## Phase 0 - Product and trust foundation

Status: proposed

Goal:

- define the architecture, trust model, and MVP boundary before implementation drift starts

Milestones:

- [x] create research-backed build plan
- [ ] define user roles and admin roles
- [ ] define action approval categories
- [ ] define memory classes and retention defaults
- [ ] decide whether the first pilot uses Google Workspace or Microsoft 365 as the primary suite

Exit criteria:

- the trust model is explicit
- the first pilot scope is narrow and realistic
- the team agrees on the MVP tool set

## Phase 1 - Executive portal shell

Status: proposed

Goal:

- ship the first serious multi-user portal experience in `apps/dashboard`

Milestones:

- [ ] assistant home page
- [ ] chat workspace
- [ ] artifact / work-product side panel
- [ ] assistant picker and role presets
- [ ] approvals inbox shell
- [ ] settings and memory controls shell

Exit criteria:

- an executive can log in, chat, review artifacts, and see pending approvals in one cohesive UI

## Phase 2 - Identity, org policy, and audit

Status: proposed

Goal:

- make the product safe for real internal use

Milestones:

- [ ] org-aware assistant access controls
- [ ] SSO enforcement path
- [ ] role-based assistant visibility
- [ ] audit event schema for prompts, tool calls, approvals, and outbound actions
- [ ] admin audit pages
- [ ] emergency disable controls

Exit criteria:

- every important action is attributable and reviewable
- admins can answer who did what, when, and through which assistant

## Phase 3 - Tool gateway v1

Status: proposed

Goal:

- expose a narrow, safe set of useful tools

Milestones:

- [ ] user-scoped email draft tool
- [ ] calendar read tool
- [ ] meeting brief tool
- [ ] company docs search tool
- [ ] CRM read-only account summary tool
- [ ] tool policy abstraction with allowlists and approval rules

Exit criteria:

- the portal is useful for daily executive prep without needing broad autonomous control

## Phase 4 - Workflow engine and scheduled automation

Status: proposed

Goal:

- add repeatable, high-value executive workflows

Milestones:

- [ ] daily briefing workflow
- [ ] pre-meeting dossier workflow
- [ ] post-meeting follow-up workflow
- [ ] scheduled task system
- [ ] workflow execution logs
- [ ] workflow publishing/versioning for admins

Exit criteria:

- the assistant can reliably deliver repeatable outcomes, not just answer chat prompts

## Phase 5 - Skills system

Status: proposed

Goal:

- make assistant behavior portable, inspectable, and testable

Milestones:

- [ ] `SKILL.md` schema and metadata conventions
- [ ] skills registry
- [ ] skill review/publishing workflow
- [ ] assistant-to-skill attachment model
- [ ] skill test harness for expected behavior and forbidden actions

Exit criteria:

- specialized assistant behavior no longer lives only in hidden prompt strings

## Phase 6 - Isolated runtime and high-trust actions

Status: proposed

Goal:

- support heavier automation without weakening the platform boundary

Milestones:

- [ ] isolated browser runtime
- [ ] isolated document processing runtime
- [ ] optional code execution runtime for internal power users
- [ ] per-task credentials and sandbox teardown
- [ ] runtime receipts back into audit logs

Exit criteria:

- sensitive automations run in isolated sandboxes with strong logging and cleanup

## Phase 7 - Knowledge and memory v2

Status: proposed

Goal:

- move from generic chat history to scoped, controlled memory and retrieval

Milestones:

- [ ] memory UI for user edits and deletes
- [ ] memory categories and retention policies
- [ ] organization knowledge ingestion
- [ ] source citation and freshness metadata
- [ ] assistant-scoped knowledge packs

Exit criteria:

- the assistant remembers the right things, for the right people, for the right amount of time

## Phase 8 - Pilot and hardening

Status: proposed

Goal:

- run a tight executive pilot with measurable safety and usefulness

Milestones:

- [ ] onboard 5 to 10 internal or design-partner executives
- [ ] measure briefing quality, approval frequency, and task completion rates
- [ ] review false approvals, noisy memory, and policy misses
- [ ] tighten redaction and retention controls
- [ ] finalize enterprise packaging

Exit criteria:

- pilot users rely on it weekly
- security review passes without a separate architecture fork

## MVP recommendation

Do not start with "full autonomous executive agent."

Start with:

- secure chat
- company docs retrieval
- meeting prep
- daily briefings
- email drafting with approval
- calendar context
- admin audit
- user memory controls

Defer:

- broad browser autonomy
- unrestricted code execution
- open plugin marketplace
- user-installed tools
- multi-channel bot sprawl

## Current recommended slice

Slice name:

- executive portal shell + tool gateway v1

Scope:

- build the first assistant workspace in `apps/dashboard`
- add artifact panel and approvals inbox shell
- add backend assistant session APIs in `packages/enterprise-control-plane`
- define tool gateway contracts for:
  - docs search
  - calendar read
  - email draft
  - CRM read-only summary
- define audit event schemas for assistant turns and tool usage
- define the first `SKILL.md` metadata format and registry conventions

Files and surfaces likely touched:

- `apps/dashboard/src/app/*`
- `apps/dashboard/src/components/*`
- `packages/enterprise-control-plane/src/*`
- `docs/plans/*`

## Non-goals

- cloning OpenClaw's gateway model directly
- turning the dashboard into a developer IDE
- exposing raw plugin execution to end users
- making every integration autonomous from day one
- relying on one model provider or one agent framework

## Open questions

- Should the first pilot be Google Workspace-first, Microsoft 365-first, or dual-path?
- Should workflows be stored in the database, in repo-backed files, or both?
- Should `SKILL.md` assets stay repo-native for reviewability, then sync into the product registry?
- Should heavy browser actions run through the current secure executor package or a sibling runtime with weaker secrets access but stronger browser ergonomics?

## References

- LibreChat features: https://www.librechat.ai/docs/features
- LibreChat MCP: https://www.librechat.ai/docs/features/mcp
- LibreChat SAML: https://www.librechat.ai/docs/configuration/authentication/SAML
- OpenClaw overview: https://docs.openclaw.ai/
- OpenClaw security: https://docs.openclaw.ai/gateway/security
- OpenClaw trusted proxy auth: https://docs.openclaw.ai/gateway/trusted-proxy-auth
- OpenClaw cron: https://docs.openclaw.ai/cron
- Dify GitHub: https://github.com/langgenius/dify
- Dify workflow/chatflow docs: https://docs.dify.ai/en/use-dify/build/workflow-chatflow
- Dify key concepts: https://docs.dify.ai/en/guides/workflow/node/start
- Dify sandbox: https://github.com/langgenius/dify-sandbox
- OpenHands runtime architecture: https://docs.all-hands.dev/usage/architecture/runtime
- OpenHands runtimes overview: https://docs.all-hands.dev/openhands/usage/runtimes/overview
- Open WebUI artifacts: https://docs.openwebui.com/features/code-execution/artifacts/
- Open WebUI functions: https://docs.openwebui.com/features/extensibility/plugin/functions/
- Open WebUI pipelines: https://docs.openwebui.com/features/extensibility/pipelines/
- Open WebUI models: https://docs.openwebui.com/features/workspace/models/
- GitHub agent skills standard: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- GitHub creating skills: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills
- Space Agent: https://space-agent.ai/
- Agent Zero docs hub: https://github.com/agent0ai/agent-zero/blob/main/docs/README.md
- Agent Zero release notes: https://github.com/agent0ai/agent-zero/releases
