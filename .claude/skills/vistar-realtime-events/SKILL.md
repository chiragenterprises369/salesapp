---
name: vistar-realtime-events
description: How Vistar publishes, transports and consumes realtime domain events (Socket.IO, Redis event bus, TanStack Query cache patching, presence). Use when emitting events in the API or reacting to them in the web app, dashboard or Team Floor.
---

# Vistar realtime events

Contract: `packages/shared/src/events.ts` (`eventPayloadSchemas`, `DomainEvent`, `rooms`,
`ServerToClientEvents`, `ClientToServerEvents`, `SYNC_SCOPES`, heartbeat constants).
Server bus: `apps/api/src/infra/events/event-bus.service.ts` (`EventBus`).
Mock stream: `createEventSimulator()` in `@vistar/shared/fixtures`.

## Envelope
`{ id, type, workspaceId, occurredAt, actor, userId?, payload }`. Socket.IO event name = `type`.
Payload must parse with `eventPayloadSchemas[type]`. Add a new event = CONTRACT-REQUEST.

## Publishing (API)
```ts
const lead = await this.prisma.forTenant(wid).$transaction(async (tx) => { ... });   // commit first
await this.events.publish('lead.created', wid, { lead: toLeadListItem(lead) }, { actor: { type: 'user', id: auth.userId, name } });
```
- Publish AFTER commit, never inside a `$transaction` callback. If the transaction fails, no event.
- Payloads carry the full list item (`LeadListItem`, `Task`, `Call`) so clients patch caches without refetching.
- `userId` on the envelope targets one user room (notifications, task.overdue for the assignee).
- Exactly-once side effects (outbound webhooks, workflow triggers) subscribe via `events.subscribe()` and enqueue BullMQ jobs with `jobId = \`${event.id}:${target}\``.

## Transport (realtime-integrations)
- Namespace `/realtime`; auth `handshake.auth.token` (workspace audience only; platform tokens rejected).
- Join `rooms.workspace(wid)` and `rooms.user(uid)` on connect. Joinable on request: `lead:`, `workflow:`, `run:`, `conv:` after a tenant check.
- Data scope applies to fan-out: for `own`/`team` users, only emit lead/task/call/conversation events they may see (filter per socket or per role room).
- Redis adapter for multiple API instances. On reconnect emit `sync.required { scopes, reason }`.

## Consuming (web)
- One socket per tab, created after login, closed on logout. Reconnect with backoff.
- Patch caches with `queryClient.setQueriesData` on the keys from `lib/leads/data.ts` (`leadKeys`), never `refetch` on every event.
  - `lead.created` -> prepend to matching lists and the first board column (respect active filters; if unsure, invalidate that key).
  - `stage.changed` -> `applyMoveToBoard(board, lead, toStageId)`; skip if this tab caused it (compare `actor.id` or mutation in flight).
  - `lead.updated` / `lead.assigned` -> replace the item by id (check `version`, ignore older).
- On `sync.required`: `queryClient.invalidateQueries({ queryKey: [scope] })` for each scope.
- Dedupe by `event.id` (keep the last 500 ids).
- UI feedback: new rows slide in with highlight; KPI numbers tick up; toasts only for things addressed to the user (assignments, replies).

## Presence and the Team Floor
- Client sends `presence.heartbeat { activity }` every `HEARTBEAT_INTERVAL_MS`; offline after `PRESENCE_TIMEOUT_MS`.
- Status changes (`employee.status_changed`) come from heartbeats, call events and the Employee status control (`PUT /me/status`).
- Floor reacts only to events: `employee.status_changed`, `lead.created`, `lead.assigned`, `call.started`, `call.ended`, `task.overdue`, `attention.raised/resolved`. Initial state: `GET /team-floor/snapshot`.

## Testing
- Unit: feed `createEventSimulator().next()` output into cache updaters and assert cache state.
- Integration: publish on the bus, assert a connected test socket receives it and a socket from another workspace does not.
