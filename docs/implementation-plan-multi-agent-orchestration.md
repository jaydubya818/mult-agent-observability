# Implementation Plan — Multi-Agent Orchestration & Observability

## Principles

1. **Inspect before build** — stack, structure, and reuse documented in `technical-design-multi-agent-orchestration.md` §2.
2. **Vertical slices** — each slice delivers a thin end-to-end increment (persisted + API + realtime + observable behavior) before piling on UI chrome.
3. **Backend & realtime first** — domain, HTTP, WebSocket contracts before large UI surface area.
4. **Reuse design system** — `--theme-*`, existing header/shell patterns.
5. **No placeholder scaffolding** — every user-facing control maps to a real API path or is explicitly deferred in this doc.

---

## Sequencing overview

```
Slice 1 ─► Slice 2 ─► Slice 3 ─► Slice 4 ─► Slice 5 ─► Slice 6 ─► Slice 7 …
 (domain)   (HTTP)     (WS)       (engine)    (synth      (orch UI     (hardening)
                                  +sim)       events)     minimal)
```

Slices **5–6** may overlap slightly once WS is stable, but **no** orchestration-only UI work before Slice 3 accepts connections.

---

## Vertical slices

### Slice 1 — Domain persistence ✓ (baseline)

**Goal**: Durable teams / agents / tasks / messages / metrics with clear FKs and indexes.

**Deliverables**

- [x] SQLite DDL + migrations via `initOrchestrationSchema()`
- [x] Repository CRUD in `apps/server/src/orchestration/repository.ts`
- [x] Types in `apps/server/src/orchestration/types.ts`

**Verify**: Unit smoke via repository calls or scripted `bun` REPL; DB file contains `orchestration_*` tables after server start.

**Status**: **Done** (current repo)

---

### Slice 2 — Orchestration HTTP (CRUD) ✓

**Goal**: External clients can manage entities without WebSocket.

**Deliverables**

- [x] `handleOrchestrationRequest` in `orchestration/http.ts`
- [x] Mount before legacy routes in `index.ts` (or explicit path priority)
- [x] Demo seed endpoint `POST /api/orchestration/demo/seed`

**Verify**: `curl`/HTTPie for create team → create agent → create task → list; delete team cascades.

**Status**: **Done**

---

### Slice 3 — Realtime snapshot (WebSocket) ✓

**Goal**: Subscribers receive authoritative orchestration state over the same `/stream` socket used for hook events.

**Deliverables**

- [x] Message type `orchestration_state` with full `OrchestrationSnapshot`
- [x] Send snapshot on client connect (after `initial` hook batch)
- [x] Broadcast on non-GET orchestration mutations

**Verify**: Connect WS; mutate via POST; observe second `orchestration_state` frame.

**Status**: **Done**

---

### Slice 4 — Engine + simulated execution ✓

**Goal**: Start/stop team runs; parallel in-flight tasks up to idle agent count; cooperative cancel.

**Deliverables**

- [x] `ExecutionEnvironment` interface + `SimulatedEnvironment`
- [x] `OrchestrationEngine` (assignment loop, metrics side effects)
- [x] `execution/start` + `execution/stop` wired

**Verify**: Seed demo; start team; watch tasks move `queued → running → done`; stop mid-run requeues or cancels per design.

**Status**: **Done** (simulated workload only)

---

### Slice 5 — Synthetic hook events (timeline parity) ✓

**Goal**: Orchestration milestones appear in existing event timeline for cross-cutting observability.

**Deliverables**

- [x] `insertEvent` from engine with `source_app = orchestration`
- [x] `onHookEvent` → broadcast `type: event` to WS clients

**Verify**: Filter Observability UI by `source_app` / session (team id) as supported by existing FilterPanel.

**Status**: **Done**

---

### Slice 6 — Orchestration UI (wired, minimal chrome first) ✓

**Goal**: Single screen can run the full demo story end-to-end **using live state**—no static mocks.

**Deliverables**

- [x] `useWebSocket` handles `orchestration_state`
- [x] `useOrchestrationApi` for mutations
- [x] `OrchestrationPanel.vue` + tab in `App.vue`
- [x] Flows: create team, enqueue task, seed demo, message orchestrator/agent, start/stop

**Verify**: Manual E2E script in PR / README (optional); click-through without console errors.

**Status**: **Done** — **follow-up**: split panel into smaller SFCs (see Slice 8)

---

### Slice 7 — Hardening & ergonomics (queued)

**Goal**: Production hygiene without feature creep.

| # | Task | Outcome |
|---|------|---------|
| 7a | Fix `useEventSearch.ts` vs `HookEvent` typing | `npm run build` passes `vue-tsc` |
| 7b | Extract orchestration route wiring from `index.ts` | `registerOrchestrationRoutes` or split fetch handler modules |
| 7c | Cap or paginate `OrchestrationSnapshot` payload | Avoid oversized WS frames on large histories |
| 7d | Idempotent demo reset (optional query: `replace=true`) | Predictable demos in CI / recordings |

**Status**: **Not started** (partially optional)

---

### Slice 8 — UI modularization (queued)

**Goal**: Keep files small and navigable per NFR.

| # | Task |
|---|------|
| 8a | Extract `TeamSidebar.vue`, `AgentGrid.vue`, `TaskBoard.vue`, `MessageThread.vue`, `MetricsStrip.vue` from `OrchestrationPanel.vue` |
| 8b | Shared `StatusPill.vue` using theme tokens |

**Status**: **Not started**

---

### Slice 9 — Real execution adapter (in progress)

**Goal**: Add a **controlled** host-process adapter and keep HTTP/WS contracts stable.

**Deliverables (current)**

- [x] `LocalProcessEnvironment` (`Bun.spawn`) behind `ExecutionEnvironment`
- [x] Env-driven **policy** (`localProcessPolicy.ts`, `ORCH_LP_*`)
- [x] Distinct terminal semantics: `cancelled` vs `timed_out` vs `failed` vs `policy_rejected` (task + run + hooks)
- [x] Integration tests: policy block, cwd, timeout, user cancel, engine stop, concurrency
- [x] Client: task columns + run detail + event feed filter by `correlation_task_id` / `task_id`

**Still prototype-grade:** no container isolation, no remote runner, policy not per-team in DB.

**Status**: **Local process MVP done** — container/remote remains future.

---

## Dependency graph (strict)

```
Slice 1 → Slice 2 → Slice 3 → Slice 4 → Slice 5
                              ↘         ↗
                               Slice 6 (after Slice 3; full value after Slice 5)
Slice 7 / 8 / 9: after Slice 6 baseline
```

---

## Phase completion checklist (run after each phase)

Copy to release notes / PR description:

1. **What was added** — tables, endpoints, WS types, UI entry points.
2. **What is working** — commands / clicks verified.
3. **What is still mocked or simulated** — e.g. `SimulatedEnvironment`, no auth.
4. **What should be built next** — next slice ID from this doc.

---

## Current status summary (as of doc v1.1)

| Area | Status |
|------|--------|
| Domain + repo | Working |
| Orchestration REST | Working |
| `orchestration_state` WS | Working |
| Engine + simulated runs | Working |
| Synthetic hook events | Working |
| Orchestration UI | Working; **monolithic SFC** — refactor scheduled (Slice 8) |
| `vue-tsc` clean build | **Failing** on legacy `useEventSearch` — Slice 7a |
| Real execution env | **`local_process` host adapter + policy** — Slice 9 (see technical design §10–11); containers TBD |

---

*Implementation plan v1.2 — vertical slices with explicit sequencing.*
