# PRD — Multi-Agent Orchestration & Observability Platform

## Document control

| Field | Value |
|-------|--------|
| Product | Multi-Agent Orchestration & Observability |
| Stack baseline | See `docs/technical-design-multi-agent-orchestration.md` §2 (repo as-is) |
| Related plans | `technical-design-multi-agent-orchestration.md`, `implementation-plan-multi-agent-orchestration.md` |

---

## 1. Repository baseline (constraints)

Work must align with the **existing** codebase (see assessment in parent conversation / technical design §2):

- **Server**: Bun + TypeScript, `bun:sqlite`, single long-lived `apps/server/src/index.ts` HTTP router, WebSocket on `/stream`.
- **Client**: Vue 3 (Composition API only — **no Pinia, no Vue Router**), Vite, Tailwind, theme via **CSS variables** (`--theme-*`) and `useThemes`.
- **Primary data path today**: Claude Code hooks → `POST /events` → SQLite `events` → `WS` `initial` + `event` → timeline UI.
- **Orchestration path (product extension)**: REST under `/api/orchestration/*` + `WS` message type `orchestration_state` + optional synthetic rows in `events` with `source_app = orchestration`.

This PRD does **not** prescribe new frameworks; it extends what exists.

---

## 2. Product vision

Provide a **control plane** to define teams and tasks, coordinate orchestrator ↔ agent messaging, run **parallel** agent workloads behind an execution-environment abstraction, and **observe** status transitions, messages, and metrics in real time—integrated with the existing hook-event observability surface.

---

## 3. Target users

| Persona | Outcome |
|--------|---------|
| Platform / reliability engineer | Healthy runs, metrics, failures visible in timeline + orchestration views |
| Automation engineer | Teams/tasks/messages CRUD, start/stop runs, trace parallel behavior |
| Reviewer / demo audience | Clear demo (e.g. two teams × four agents) with realistic flow, not mocks disconnected from APIs |

---

## 4. Core user stories

1. Create and delete **teams** scoped to orchestration data.
2. Create, list, retrieve, and update **tasks** with server-enforced statuses.
3. Register **agents** on a team; see status transitions (`idle`, `running`, …).
4. Send **orchestrator → agent** (direct or broadcast) and **agent → orchestrator** messages; read history.
5. **Start / stop** team execution such that **multiple agents** can process work concurrently (within environment limits).
6. See **real-time** updates: orchestration snapshot over WebSocket + hook-style events in the **same** timeline where applicable.
7. Run a **demo** that creates two teams of four agents with realistic tasks.

---

## 5. Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Teams: create, list, get, delete (cascade child data). |
| FR-2 | Agents: create per team, list, patch; track `current_task_id` when assigned. |
| FR-3 | Tasks: create, list by team (optional status filter), get, patch; statuses include at least `backlog`, `queued`, `running`, `done`, `failed`, `blocked`. |
| FR-4 | Messages: create with direction (`orchestrator_to_agent`, `agent_to_orchestrator`, `broadcast`), list by team, ordered by time. |
| FR-5 | Metrics: append samples per team (and optionally per agent); list recent samples. |
| FR-6 | Engine: start/stop per team; assign queued work to idle agents; emit lifecycle signals (persisted + broadcast). |
| FR-7 | Execution environment: pluggable interface; **simulated** implementation acceptable for MVP; must not block future real runner. |
| FR-8 | Observability: WebSocket delivers `orchestration_state` after connect and after state-changing operations; orchestration may emit `HookEvent` rows for `source_app = orchestration`. |
| FR-9 | Demo: HTTP action creates two teams × four agents + representative tasks. |

---

## 6. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **Modularity**: orchestration logic lives in `apps/server/src/orchestration/`; avoid growing `index.ts` without bound; client composables per concern. |
| NFR-2 | **Reuse**: New UI uses existing theme tokens and patterns (header, cards, spacing) — no parallel design system. |
| NFR-3 | **No throwaway UI**: Orchestration screens must read/write real APIs and reflect WebSocket state (no static demo pages). |
| NFR-4 | **Realtime**: Orchestration mutations visible without full page reload under normal localhost conditions. |
| NFR-5 | **Security (MVP)**: No auth; document production need for authn/z and tenant isolation. |

---

## 7. Phased roadmap (product)

| Phase | Scope |
|-------|--------|
| **P0** | Persisted domain + REST + WS snapshot + simulated engine + UI wired to backend + demo |
| **P1** | Non-simulated `ExecutionEnvironment`, auth, idempotent demo reset, patch-based WS updates |
| **P2** | Rich assignment policies, human escalation on `blocked`, export/audit |

---

## 8. Risks & assumptions

| Risk | Mitigation |
|------|------------|
| `index.ts` becomes unmaintainable | Extract route registration per domain in implementation plan |
| Large Vue SFCs | Split orchestration UI into smaller components in a dedicated slice |
| SQLite scale | WAL + short transactions; snapshot size may need caps or paging later |

**Assumption**: Single-region, trusted LAN / local dev for MVP.

---

## 9. Acceptance criteria (P0)

1. All FR-1–FR-9 satisfied via running server + client against real HTTP and WebSocket.
2. Orchestration UI: create team, add task, seed demo, start/stop execution, send messages — each updates visible state without mock-only paths.
3. Observability tab still ingests `POST /events` and renders timeline; orchestration hook events may appear when engine emits them.
4. Demo endpoint creates **2 × 4 agents** and multiple tasks per team.

---

*PRD v1.1 — aligned to repo stack; implementation sequencing in `implementation-plan-multi-agent-orchestration.md`.*
