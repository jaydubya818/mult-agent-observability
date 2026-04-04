# Technical Design — Multi-Agent Orchestration & Observability

## 1. Purpose

Describe how orchestration extends the **existing** observability platform without replacing stack choices. Implementation must stay **modular** (orchestration as a subsystem), reuse the **CSS theme contract**, and keep **realtime** behavior explicit.

---

## 2. Repository assessment (as-is)

### 2.1 Stack

| Layer | Technology |
|-------|------------|
| Runtime (server) | Bun |
| DB | SQLite via `bun:sqlite` (`events.db`, WAL) |
| Server entry | `apps/server/src/index.ts` — HTTP + WebSocket upgrade |
| Client | Vue 3.5, Vite 7, TypeScript, Tailwind 3 |
| Styling contract | CSS variables `--theme-*`, `useThemes`, optional theme CRUD API |

### 2.2 Application structure

```
apps/
  server/src/
    index.ts          # HTTP + WS fan-out (events, themes, orchestration)
    db.ts             # events + migrations; themes tables
    theme.ts          # theme service
    types.ts          # HookEvent, themes, etc.
    orchestration/    # domain (added for this product)
  client/src/
    App.vue           # shell: tabs Observability | Orchestration
    composables/      # useWebSocket, useThemes, useOrchestrationApi, …
    components/       # EventTimeline, FilterPanel, … + orchestration/
```

**No** Vue Router or Pinia: navigation is local component state (`activeSurface`); server state arrives via WebSocket + fetch.

### 2.3 State management (client)

| Concern | Mechanism |
|---------|-----------|
| Hook events | `useWebSocket` → `events` ref (cap `VITE_MAX_EVENTS_TO_DISPLAY`) |
| Orchestration snapshot | `useWebSocket` → `orchestration` ref, updated on `orchestration_state` |
| Theme | `useThemes` → document CSS variables |
| Orchestration mutations | `useOrchestrationApi` → `fetch`; server broadcasts refreshed snapshot on non-GET orchestration routes |

### 2.4 API patterns (server)

| Pattern | Usage |
|--------|--------|
| REST + JSON | `POST /events`, `/api/themes/*`, `/api/orchestration/*` |
| CORS | `*` on allowed methods (includes `PATCH` / `PUT`); allow headers include `Content-Type`, `Authorization`, `x-orchestration-admin-token` (§6.1) |
| WebSocket `/stream` | `initial` (hook events), `event` (hook append), `orchestration_state` (full snapshot) |
| Errors | JSON `{ error: string }` with 4xx where implemented |

Validation: **lightweight** (manual checks in handlers); no shared Zod layer on server today.

### 2.5 Reuse (client)

**Reuse for orchestration UI:**

- Layout/colors: `var(--theme-*)` tokens, same header chrome as Observability tab.
- Toasts, theme manager, filters/timeline on Observability tab unchanged.
- **Consider** extracting small presentational pieces (status pill, section card) if `OrchestrationPanel.vue` grows further.

**Reuse (server):**

- `insertEvent` + WS `event` broadcast path for synthetic orchestration hook events.
- Single `wsClients` set for all message types.

### 2.6 Gap analysis

| Exists | Added for orchestration |
|--------|-------------------------|
| `events` table, hook ingest | `orchestration_*` tables (teams, agents, tasks, messages, metrics, execution policies, task runs) |
| WS hook stream | `orchestration_state` message + broadcast helpers |
| Timeline, charts, swim lanes | `OrchestrationPanel` + API composable |
| — | `OrchestrationEngine`, `SimulatedEnvironment` |
| — | `POST /api/orchestration/demo/seed` |

**Technical debt (known):**

- `index.ts` is large; route handling should be split behind thin registrars when touched.
- `OrchestrationPanel.vue` is a **single large SFC** — should be split (see implementation plan).
- `vue-tsc` may fail on `useEventSearch.ts` (legacy typing vs `HookEvent`) — unrelated to orchestration but blocks strict `npm run build`.

---

## 3. Target architecture (logical)

```text
Hooks / REST clients
        │
        ▼
   Bun HTTP router ──► SQLite (events + orchestration_* + themes)
        │
        ├── OrchestrationEngine ──► ExecutionEnvironment (simulated | future: remote)
        │
        ▼
   WebSocket fan-out: initial | event | orchestration_state
        │
        ▼
   Vue client (Observability timeline │ Orchestration dashboard)
```

---

## 4. Domain model (persisted)

See PRD functional requirements; physical mapping:

- `orchestration_teams` — execution_status `stopped` | `running`; optional `execution_policy_id` → `orchestration_execution_policies`
- `orchestration_agents` — status, `current_task_id`, `metadata` JSON
- `orchestration_tasks` — status, priority, `payload` JSON
- `orchestration_messages` — direction, body, optional agent ids
- `orchestration_metrics` — key/value/unit/time series
- `orchestration_execution_policies` — persisted guardrails per `adapter_kind` (MVP: `local_process`): `cmd_allowlist`, `cmd_denylist`, `max_ms`, `max_concurrent`, `cwd_allowlist`, `env_allowlist`, `max_output_bytes`, timestamps
- `orchestration_task_runs` — **one row per `task_id`** (upserted on each execution); holds latest run correlation (`run_id`, tails, termination, etc.) including **stub rows** for pre-start failures (see §11). Not a multi-row per-task history table; pruning removes whole rows for old terminal runs (§6.3).

Cascade: delete team removes children (FK `ON DELETE CASCADE`). Deleting a policy sets team `execution_policy_id` to null (`ON DELETE SET NULL`).

---

## 5. Realtime event architecture

| Channel | Payload | When |
|---------|---------|------|
| `POST /events` | `HookEvent` | External hooks |
| `WS` `event` | saved `HookEvent` | After insert (ingest or engine `emitHook`) |
| `WS` `orchestration_state` | `OrchestrationSnapshot` | On WS connect; after orchestration **mutating** HTTP (non-GET); on engine `onStateChange` |

**Ordering**: Clients should treat `orchestration_state` as **authoritative snapshot** for control-plane UI; hook `event` stream remains primary for tool-level observability.

**Synthetic hook events** (orchestration): `source_app = orchestration`, `session_id = teamId`, types such as `OrchestrationTaskAssigned`, `OrchestrationTaskCompleted`, … — enables filtering in existing timeline.

---

## 6. HTTP surface (orchestration)

Base: `/api/orchestration`

| Method | Path | Notes |
|--------|------|--------|
| GET | `/snapshot` | Full snapshot |
| GET | `/teams` | Teams + summaries |
| POST | `/teams` | Create |
| GET | `/teams/:id` | Detail bundle |
| DELETE | `/teams/:id` | Cascade |
| POST | `/teams/:id/agents` | Create agent |
| PATCH | `/agents/:id` | Update |
| POST | `/teams/:id/tasks` | Create |
| GET | `/teams/:id/tasks` | Optional `?status=` |
| GET | `/tasks/:id` | Get |
| PATCH | `/tasks/:id` | Update |
| GET/POST | `/teams/:id/messages` | List / create |
| GET | `/teams/:id/metrics` | List |
| POST | `/teams/:id/execution/start` | Engine |
| POST | `/teams/:id/execution/stop` | Engine |
| POST | `/demo/seed` | Demo data |
| GET | `/policies` | List persisted execution policies |
| POST | `/policies` | Create policy (`adapter_kind`, fields) |
| GET | `/policies/:id` | Get one policy |
| PATCH | `/policies/:id` | Update policy fields |
| PATCH | `/teams/:id` | Update team (incl. `execution_policy_id`) |
| PUT | `/teams/:id/execution-policy` | Assign policy id to team (`{"execution_policy_id": "…"}` or null) |
| GET | `/teams/:id/effective-execution-policy` | Resolved `local_process` policy for team (source: `team_policy` \| `env_defaults`) |
| GET | `/admin-audit` | Read-only admin mutation audit log (query filters below; see §6.2) |
| POST | `/admin/prune-history` | Run retention prune using env limits; returns summary JSON (§6.3); audited as `retention_prune` |

### 6.1 Thin admin token (`ORCH_ADMIN_TOKEN`)

This is a **shared-secret gate** for sensitive orchestration mutations—not identity, sessions, or RBAC. It is easy to delete once real auth wraps `/api/orchestration`.

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Open (local dev default)** | `ORCH_ADMIN_TOKEN` unset or whitespace-only | No admin check; mutating routes behave as before. |
| **Protected** | `ORCH_ADMIN_TOKEN` set to a non-empty string | Listed mutations require `x-orchestration-admin-token: <value>` or `Authorization: Bearer <value>`. |

**401 response** (protected mode only), JSON body:

- `error`: `"Unauthorized"`
- `code`: `orchestration_admin_token_missing` — no header / bearer value
- `code`: `orchestration_admin_token_invalid` — value does not match `ORCH_ADMIN_TOKEN`
- `message`: short human-readable hint

**Protected endpoints when `ORCH_ADMIN_TOKEN` is set:**

| Method | Path | Notes |
|--------|------|--------|
| POST | `/demo/seed` | Demo data seed |
| POST | `/policies` | Create policy |
| PATCH | `/policies/:id` | Update policy |
| PUT | `/teams/:id/execution-policy` | Assign/clear team policy |
| PATCH | `/teams/:id` | Only if body contains key `execution_policy_id` |
| POST | `/teams` | Only if body contains key `execution_policy_id` |
| POST | `/admin/prune-history` | Apply configured retention (same token as other admin mutations) |

**Still open (read + most operator actions):** `GET` snapshot, teams, policies, effective policy, PATCH team **without** `execution_policy_id`, task/agent CRUD, execution start/stop, etc.

**`GET /admin-audit` auth:** When `ORCH_ADMIN_TOKEN` is **set**, the same token is required to list audit rows. In **open mode**, `GET /admin-audit` is readable without a token (local trust boundary only).

**`POST /admin/prune-history` auth:** Same as other protected mutations when `ORCH_ADMIN_TOKEN` is set; in open mode, any client may invoke it (still a sharp tool—restrict at the network layer in production).

Query parameters (all optional): `limit` (default 100, max 500), `outcome` (`success` \| `denied` \| `invalid`), `action`, `route` (exact path), `target_entity_type`, `target_entity_id`.

**CORS:** `Access-Control-Allow-Headers` includes `Authorization` and `x-orchestration-admin-token` for browser clients.

**Limitations:** One secret for all admins; no user identity in the token model; no rotation workflow or tenancy in the latch itself. Do not expose protected mode on the public internet without TLS and a strong token. Replace with proper auth for production control planes.

### 6.2 Admin mutation audit (`orchestration_admin_audit_log`)

Persisted **accountability** trail for orchestration **admin/config** mutations. This is not tamper-evident and not a full security product; it complements the thin token gate.

**Schema (SQLite):** `id`, `created_at`, `route`, `method`, `action` (mutation type), `target_entity_type`, `target_entity_id`, `outcome` (`success` \| `denied` \| `invalid`), `auth_mode` (`open_mode` \| `token`), `client_ip` (from `X-Forwarded-For` first hop or `X-Real-Ip` if present), `metadata` (JSON object, small).

**Actions logged (examples):** `demo_seed`, `policy_create`, `policy_update`, `team_execution_policy_put`, `team_execution_policy_patch`, `team_create_with_policy`, `retention_prune` (after successful `POST /admin/prune-history` only; startup prune does not write an audit row).

**What is logged:**

- Successful mutations on all protected routes (after auth passes in protected mode, or unconditionally in open mode for those routes).
- **Denied** admin attempts (401): auth failure on a protected mutation, with `metadata.denial` = `missing_token` \| `invalid_token` (no raw token values).
- **Invalid** outcomes where practical: validation failures **after** auth (e.g. create policy without `name`, unknown `execution_policy_id` on assign), with a short `metadata.error` code.

**What is intentionally not logged:**

- Raw `ORCH_ADMIN_TOKEN`, `Authorization` header, or `x-orchestration-admin-token` values.
- Full request bodies (only small structured `metadata` snippets).
- Arbitrary request headers.

**Limitations:** No cryptographic integrity; anyone with DB access can alter rows. `client_ip` is best-effort and may be wrong behind proxies. No per-user identity (token is shared). Audit rows grow until **retention** (§6.3) removes them. Audit read API in open mode exposes history to any client that can reach the server—use protected mode or network isolation for real deployments.

### 6.3 Retention & pruning (operational hygiene)

Env-configured retention prevents audit and task-run tables from growing without bound. **No cron subsystem**—prune runs **once at server startup** (after migrations) and can be run again via **`POST /api/orchestration/admin/prune-history`**.

| Variable | Table | Effect |
|----------|--------|--------|
| `ORCH_ADMIN_AUDIT_MAX_DAYS` | `orchestration_admin_audit_log` | Delete rows with `created_at` older than N days (omit or ≤0: disabled). |
| `ORCH_ADMIN_AUDIT_MAX_ROWS` | `orchestration_admin_audit_log` | After age step, keep at most **N** rows by deleting **oldest** `created_at` first (omit or ≤0: disabled). |
| `ORCH_TASK_RUNS_MAX_DAYS` | `orchestration_task_runs` | Delete **prunable** rows (see below) with `finished_at` older than N days. |
| `ORCH_TASK_RUNS_MAX_ROWS` | `orchestration_task_runs` | After age step, cap **prunable** rows globally—drop oldest by `finished_at` until count ≤ N. |

**Precedence when both age and row cap are set (each table):** **age-based deletion runs first**, then **row-cap** trims excess among remaining rows.

**`orchestration_task_runs` prunable rows:** `status IN ('completed','failed','cancelled','timed_out','policy_rejected')` **and** `finished_at IS NOT NULL`. Rows in **`pending`** or **`running`** are never deleted by retention.

**What is preserved:** All non-prunable task runs; all audit rows inside the age window and within the row cap; tasks/agents/teams/policies are untouched.

**Observability:** If any row was deleted, the server emits **one structured `console.log` line** to stdout: `[orchestration:retention]` plus JSON summary (`removed_by_*`, config echo). The hook **event** stream is not used (avoids noise). Manual `POST /admin/prune-history` also appends an admin-audit **`retention_prune`** success row with aggregate counts.

**Limitations:** Startup prune runs before traffic—brief extra work on boot. No per-tenant retention. Row caps are **global** for task runs (not per team). Trimming **deletes** run rows outright—UI may show “no execution record” for old tasks until re-run; this is intentional hygiene, not archival. For compliance archives, export DB or ship logs separately.

---

## 7. UI views (contract)

| View | Responsibility | State source |
|------|----------------|--------------|
| **Observability** | Timeline, filters, pulse chart, swim lanes | `useWebSocket.events` |
| **Orchestration** | Teams sidebar, agent grid, task columns, messages, metrics, demo/start/stop; collapsible **Recent admin mutations** (read-only `GET /admin-audit`, uses admin token when server requires it); **local_process**: policy summary + **assign policy** UI; task detail highlights **policy_rejected** | `useWebSocket.orchestration` + `useOrchestrationApi` for writes |

All orchestration controls must hit real endpoints and reflect updates via WS snapshot (or explicit refresh emit where GET-only).

---

## 8. Modularity rules

- **Server**: New behavior in `orchestration/*`; avoid bloating `repository` with non-ORM helpers unrelated to SQL—keep “engine” free of raw SQL where possible.
- **Client**: One composable per integration (`useOrchestrationApi`, `useWebSocket`); SFCs **&lt; ~400 lines** where practical — split into `components/orchestration/*` as needed.
- **No** “placeholder” routes or dead buttons — if a control exists, it must invoke API or show a deliberate “disabled + reason” (feature flag).

---

## 9. What is simulated vs real (MVP)

| Component | MVP behavior |
|-----------|----------------|
| `SimulatedEnvironment` | Delay-based “work”; cancel resolves `user_cancelled` vs `engine_stopped` via `resolveCancellationKind()` |
| `LocalProcessEnvironment` | `Bun.spawn` on host; guarded by **env policy** (see §10). **Not** a sandbox—same OS user as the server. |
| Future adapters | Container / queue-backed runners behind the same `ExecutionEnvironment` interface |

---

## 10. Local process execution policy (persisted + env)

### 10.1 Resolution order (authoritative)

When the active execution adapter is `local_process`, the effective policy for a task is resolved in this order:

1. **Team-linked persisted policy** — if `orchestration_teams.execution_policy_id` is set and the row’s `adapter_kind` is `local_process`, that row **fully defines** allow/deny lists, per-task `max_ms`, per-team `max_concurrent`, cwd/env allowlists, and `max_output_bytes` for that team’s launches.
2. **Execution profile / multi-adapter policy** — *reserved*; no separate profile table in MVP. Extension point: insert a layer here before env without changing team FK shape.
3. **Environment defaults** — `ORCH_LP_*` variables via `loadLocalProcessPolicyFromEnv()` when the team has no linked policy (or linked policy is missing / wrong adapter).
4. **Hardcoded safe fallback** — built-in deny basenames and conservative defaults inside policy construction when env omits values.

`GET /api/orchestration/teams/:id/effective-execution-policy` returns JSON indicating `source: "team_policy" | "env_defaults"` and the resolved numeric/list fields for operators.

### slot ceiling (global vs team)

- **`ORCH_LP_MAX_CONCURRENT`** caps **total** concurrent `local_process` workloads across all teams (global semaphore).
- Each launch also respects the effective policy’s **`max_concurrent`** for that team (stricter of the two applies per acquire path).
- Team **persisted** `max_concurrent` is stored on the policy row; env singleton uses `ORCH_LP_MAX_CONCURRENT` for both semantics in the env-only case (see code).

### 10.2 Environment variables (when no team policy)

| Variable | Purpose |
|----------|---------|
| `ORCH_LP_CMD_ALLOWLIST` | Comma-separated **basenames** of argv0; if set, only those commands may run. |
| `ORCH_LP_CMD_DENYLIST` | Extra deny basenames (merged with built-in defaults: `curl`, `wget`, `ssh`, `docker`, …). |
| `ORCH_LP_MAX_MS` | Max runtime per task; overrun sends SIG kill path → **timed_out** (see §11). |
| `ORCH_LP_MAX_CONCURRENT` | Global concurrent subprocess slots + env-policy concurrent limit. |
| `ORCH_LP_CWD_ALLOWLIST` | Comma-separated absolute directory roots; empty means **no custom** `payload.cwd` (inherit server cwd only). |
| `ORCH_LP_ENV_ALLOWLIST` | Keys allowed to merge from `payload.env` into the process environment; empty means **reject** any `payload.env`. |
| `ORCH_LP_MAX_OUTPUT_BYTES` | Cap on retained stdout+stderr bytes (tail buffers in `orchestration_task_runs`). |

### 10.3 Current limitations

- Policy is evaluated on the server only; payloads can still request disallowed commands until the adapter runs—**trust the allow/deny lists** for casual abuse, not hostile multi-tenant isolation.
- No seccomp, no user switching, no network egress control, no Docker/multi-tenant isolation.
- Admin policy APIs are open on the LAN; **add auth** before any multi-tenant or internet exposure.

---

## 11. Task / run / agent terminal semantics

**Workload terminal** (`WorkloadTerminalKind`): `success` | `user_cancelled` | `engine_stopped` | `timed_out` | `policy_rejected` | `process_error`.

| Outcome | Task status | Run row status | `termination_reason` (run) | Agent after |
|---------|-------------|----------------|------------------------------|-------------|
| Success | `done` | `completed` | `success` | `idle` |
| Non‑zero exit / thrown spawn error | `failed` | `failed` | `process_error` | `idle` |
| User cancel (HTTP cancel while running) | `cancelled` | `cancelled` | `user_cancelled` | `idle` |
| Engine stop / team stopped (in-flight workload cancelled) | `cancelled` | `cancelled` | `engine_stopped` | `idle` |
| Policy / concurrency reject (`local_process` evaluates before `ExecutionStarted`) | `failed` | `policy_rejected` | Human-readable reason in `termination_reason` / `error_message` | `idle` |
| Per-task timeout (`ORCH_LP_MAX_MS`) | `timed_out` | `timed_out` | `timed_out` | `idle` |

**Correlation in hook payloads:** synthetic events include `correlation_task_id`, `task_id`, `run_id`, `agent_id`, and `adapter_kind` where applicable so the UI can join task detail ↔ hook stream.

**Engine scheduling:** the tick loop assigns work while there are **idle agents** not already in `activeRuns`; parallel throughput is not incorrectly capped by “current idle count” alone.

**Rejected-run audit:** On pre-start policy failure, the engine records a **`orchestration_task_runs` row** with `status = policy_rejected`, a fresh `run_id`, `task_id`, `agent_id` when known, `adapter_kind`, timestamps (`started_at` / `finished_at` set to the rejection instant), and the rejection string in `termination_reason` (and often `error_message`). This guarantees every execution attempt leaves a durable audit record and the UI can show a consistent execution panel.

---

*Technical design v1.6*
