---
name: vistar-workflow-nodes
description: Vistar workflow graph contract, node catalogue, handles, configs, validation, variables, templates, execution semantics and compliance guards. Use when building the workflow builder UI, the BullMQ engine, node executors or workflow tests.
---

# Vistar workflow nodes

Contract (read, never copy): `packages/shared/src/workflow/{nodes,graph,templates}.ts`,
`packages/shared/src/schemas/workflow.ts`, events `workflow.*` in `events.ts`.

## Graph
- `WorkflowGraph = { schemaVersion: 1, version, nodes, edges }`. React Flow compatible:
  `node = { id, type, position, data: { label?, notes?, config } }`, `edge = { id, source, target, sourceHandle, targetHandle: 'in' }`.
- Node `type` is `<category>.<name>` (`trigger.*`, `action.*`, `logic.*`, `ai.*`). Categories drive palette groups and colour accents (trigger = indigo, action = blue, logic = amber, ai = grey chip tones; use tokens).
- Exactly one trigger. Triggers have no input handle. Every other node has input `in`.
- Output handles come from `NODE_CATALOG[type].outputs(config)`: most `['out']`; `logic.condition` `['yes','no']`; `logic.dedupe` `['unique','duplicate']`; `logic.loop_limit` `['out','exceeded']`; `logic.switch` = case keys + `'default'`; `ai.classify_intent` = labels; `logic.stop` `[]`.
- One edge per output handle. Cycles must pass through `logic.loop_limit`.
- `validateGraph(graph, { aiEnabled })` returns `GraphIssue[]` (`error` blocks publish/test, `warning` = unreachable step). Show errors inline on the node and in the right panel.

## Configs
- Each type's config schema is `nodeConfigSchemas[type]` (zod). Builder forms are generated from or written against these; save only data that parses.
- Configs reference stable keys, not ids: `stageKey`, `templateName`, `endpointId` (webhook), `userIds` (assignment pools).
- `ai.*` nodes have `featureFlag: 'FEATURE_AI_NODE'` (workspace flag `ai_node`): hide from the palette when off.
- Messaging nodes (`sendsMessage: true`): WhatsApp template/text, email, SMS. They always pass the compliance guards.

## Variables and preview
- `WORKFLOW_VARIABLES` (key, label, example) feed the variable picker; insert as `{{lead.name}}`.
- `renderTemplate(text, context)` renders previews (use the `example` values as context) and is used by the engine at send time. Unknown paths render empty.

## Templates
- `WORKFLOW_TEMPLATES`: IndiaMART nurturing, missed-call follow-up, quote reminder, inactive lead revival. All validate with 0 issues. Seeded per workspace; WhatsApp templates they use are in `WHATSAPP_TEMPLATE_FIXTURES` (approved).
- Layout grid: 300 px columns, 150 px rows (template positions use it; auto-layout should too).

## Execution semantics (engine)
- A run = one lead through one published `WorkflowVersion` (never the draft, except test runs).
- One `WorkflowRunStep` per node visit (`@@unique([runId, nodeId, visit])`); `branch` = handle taken; `summary` = human sentence ("Sent template indiamart_welcome").
- `logic.wait`: delayed BullMQ job; `businessHoursOnly` uses workspace `businessHours`, `holidays`, `timezone`; `resumeOnReply` resumes early on `message.received` for that lead.
- `logic.condition kind=replied`: inbound message after the last outbound (or run start). `keyword`: latest reply text, case-insensitive, Hinglish keywords allowed.
- `logic.switch on=reply_keyword`: first case whose `value` list matches the latest reply; else `default`.
- `logic.dedupe`: match by phone/email/sourceRef within N days -> `duplicate`.
- `action.assign_owner`: round_robin (cursor per workflow in Redis), least_busy (fewest open leads + on-call penalty), rule, specific; respects `onlyIfUnassigned`.
- Retries with exponential backoff for transient errors; permanent errors fail the step and the run, emit `workflow.failed`, raise attention `workflow_failed`.
- Idempotency: run key `${workflowId}:${leadId}:${triggerEventId}`; job id `${runId}:${nodeId}:${visit}`.

## Compliance guards (before every message)
Order and error codes (`ErrorCode`):
1. Contact opted out or DND -> `CONSENT_OPTED_OUT` (step `skipped`, run continues on `out`).
2. First contact on WhatsApp must be an approved template -> `WHATSAPP_TEMPLATE_NOT_APPROVED`.
3. Free-form WhatsApp only within 24 h of the last inbound (`WHATSAPP_WINDOW_HOURS`) -> `WHATSAPP_WINDOW_CLOSED`.
4. Quiet hours (outside business hours, default 21:00-09:00 workspace time) -> reschedule to next opening, not fail.
5. Per-number rate limit -> `SEND_RATE_LIMITED`, retry later.
Record the guard result in the step `summary`/`error` so the run log explains it.

## Realtime and run view
- `workflow.step_updated { runId, workflowId, step, nextEdgeId }` drives live pass/fail badges and packet animation along `nextEdgeId`.
- `workflow.run_updated` updates run lists; `workflow.failed` feeds "Needs attention" and notifications.
- Test runs (`WorkflowTestRunSchema`): `dummyLead`, `simulateReply`, `waitScale` (0 = skip waits), `dryRun` (no real sends). The builder subscribes to `run:<id>` and animates.

## Builder UI expectations (frontend-physics)
- Palette grouped by category, search, drag onto canvas; right panel: config form, template picker (approved templates only for first contact), variable picker, message preview, validation errors.
- Draft/Active toggle, publish (blocked while errors exist), version history and rollback, duplicate, undo/redo, copy/paste, multi-select, auto-layout, minimap, keyboard shortcuts (show a shortcut sheet).
- Rope edges: verlet ~12 points per edge, settle and pause when idle; flat mode = plain bezier.
