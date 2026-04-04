import { db } from '../db';
import type {
  AdminAuditRecord,
  Agent,
  AgentStatus,
  EffectiveLocalProcessPolicy,
  ExecutionPolicy,
  OrchestrationMessage,
  OrchestrationMetric,
  OrchestrationSnapshot,
  Task,
  TaskRunRecord,
  TaskStatus,
  TaskTransition,
  Team,
  TeamExecutionStatus,
  TeamSummary,
} from './types';
import { getExecutionEnvironmentKind } from './runtimeMeta';
import {
  getLocalProcessPolicy,
  localProcessPolicyToEffective,
  policyFromPersistedRecord,
  streamTailCharBudget,
} from './environments/localProcessPolicy';
import { getRetryMetaFromPayload } from './retryPolicy';

export function initOrchestrationSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      execution_status TEXT NOT NULL DEFAULT 'stopped',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestration_agents (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      environment_kind TEXT NOT NULL DEFAULT 'simulated',
      current_task_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orchestration_tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 0,
      assignee_agent_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orchestration_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_agent_id TEXT,
      to_agent_id TEXT,
      body TEXT NOT NULL,
      kind TEXT NOT NULL,
      correlation_task_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orchestration_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      agent_id TEXT,
      key TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orchestration_task_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      agent_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orchestration_task_runs (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      team_id TEXT NOT NULL,
      agent_id TEXT,
      environment_kind TEXT NOT NULL DEFAULT 'simulated',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt INTEGER NOT NULL DEFAULT 1,
      stdout_tail TEXT NOT NULL DEFAULT '',
      stderr_tail TEXT NOT NULL DEFAULT '',
      stdout_bytes INTEGER NOT NULL DEFAULT 0,
      stderr_bytes INTEGER NOT NULL DEFAULT 0,
      exit_code INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      error_message TEXT,
      termination_reason TEXT,
      FOREIGN KEY (team_id) REFERENCES orchestration_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES orchestration_tasks(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_execution_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter_kind TEXT NOT NULL DEFAULT 'local_process',
      cmd_allowlist TEXT,
      cmd_denylist TEXT NOT NULL DEFAULT '[]',
      max_ms INTEGER NOT NULL,
      max_concurrent INTEGER NOT NULL,
      cwd_allowlist TEXT NOT NULL DEFAULT '[]',
      env_allowlist TEXT,
      max_output_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orch_agents_team ON orchestration_agents(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_tasks_team ON orchestration_tasks(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_tasks_status ON orchestration_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_orch_messages_team ON orchestration_messages(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_metrics_team ON orchestration_metrics(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_task_trans_team ON orchestration_task_transitions(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_task_trans_task ON orchestration_task_transitions(task_id);
    CREATE INDEX IF NOT EXISTS idx_orch_task_runs_team ON orchestration_task_runs(team_id);
    CREATE INDEX IF NOT EXISTS idx_orch_execution_policies_adapter ON orchestration_execution_policies(adapter_kind);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_admin_audit_log (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      route TEXT NOT NULL,
      method TEXT NOT NULL,
      action TEXT NOT NULL,
      target_entity_type TEXT,
      target_entity_id TEXT,
      outcome TEXT NOT NULL,
      auth_mode TEXT NOT NULL,
      client_ip TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_orch_admin_audit_created ON orchestration_admin_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orch_admin_audit_action ON orchestration_admin_audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_orch_admin_audit_outcome ON orchestration_admin_audit_log(outcome);
  `);
  migrateOrchestrationTaskRunsColumns();
  migrateOrchestrationTeamsPolicyColumn();
}

function migrateOrchestrationTeamsPolicyColumn(): void {
  const cols = db.prepare(`PRAGMA table_info(orchestration_teams)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'execution_policy_id')) {
    db.exec(`ALTER TABLE orchestration_teams ADD COLUMN execution_policy_id TEXT REFERENCES orchestration_execution_policies(id) ON DELETE SET NULL`);
  }
}

function rowToExecutionPolicy(row: any): ExecutionPolicy {
  return {
    id: row.id,
    name: row.name,
    adapter_kind: row.adapter_kind ?? 'local_process',
    cmd_allowlist: parseJson<string[] | null>(row.cmd_allowlist, null),
    cmd_denylist: parseJson<string[]>(row.cmd_denylist, []),
    max_ms: row.max_ms,
    max_concurrent: row.max_concurrent,
    cwd_allowlist: parseJson<string[]>(row.cwd_allowlist, []),
    env_allowlist: parseJson<string[] | null>(row.env_allowlist, null),
    max_output_bytes: row.max_output_bytes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listExecutionPolicies(): ExecutionPolicy[] {
  const rows = db
    .prepare(`SELECT * FROM orchestration_execution_policies ORDER BY name COLLATE NOCASE`)
    .all() as any[];
  return rows.map(rowToExecutionPolicy);
}

export function getExecutionPolicyById(id: string): ExecutionPolicy | null {
  const row = db.prepare(`SELECT * FROM orchestration_execution_policies WHERE id = ?`).get(id) as any;
  return row ? rowToExecutionPolicy(row) : null;
}

export function createExecutionPolicy(input: {
  name: string;
  adapter_kind?: string;
  cmd_allowlist?: string[] | null;
  cmd_denylist?: string[];
  max_ms?: number;
  max_concurrent?: number;
  cwd_allowlist?: string[];
  env_allowlist?: string[] | null;
  max_output_bytes?: number;
}): ExecutionPolicy {
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    cmd_allowlist: input.cmd_allowlist ?? null,
    cmd_denylist: input.cmd_denylist ?? [],
    max_ms: input.max_ms ?? 300_000,
    max_concurrent: input.max_concurrent ?? 4,
    cwd_allowlist: input.cwd_allowlist ?? [],
    env_allowlist: input.env_allowlist ?? null,
    max_output_bytes: input.max_output_bytes ?? 256_000,
  };
  db.prepare(
    `INSERT INTO orchestration_execution_policies (
       id, name, adapter_kind, cmd_allowlist, cmd_denylist, max_ms, max_concurrent,
       cwd_allowlist, env_allowlist, max_output_bytes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.adapter_kind ?? 'local_process',
    JSON.stringify(row.cmd_allowlist),
    JSON.stringify(row.cmd_denylist),
    row.max_ms,
    row.max_concurrent,
    JSON.stringify(row.cwd_allowlist),
    row.env_allowlist === null ? null : JSON.stringify(row.env_allowlist),
    row.max_output_bytes,
    now,
    now
  );
  return getExecutionPolicyById(id)!;
}

export function updateExecutionPolicy(
  id: string,
  patch: Partial<{
    name: string;
    adapter_kind: string;
    cmd_allowlist: string[] | null;
    cmd_denylist: string[];
    max_ms: number;
    max_concurrent: number;
    cwd_allowlist: string[];
    env_allowlist: string[] | null;
    max_output_bytes: number;
  }>
): ExecutionPolicy | null {
  const cur = getExecutionPolicyById(id);
  if (!cur) return null;
  const next = {
    ...cur,
    ...patch,
    cmd_allowlist: patch.cmd_allowlist !== undefined ? patch.cmd_allowlist : cur.cmd_allowlist,
    cmd_denylist: patch.cmd_denylist !== undefined ? patch.cmd_denylist : cur.cmd_denylist,
    cwd_allowlist: patch.cwd_allowlist !== undefined ? patch.cwd_allowlist : cur.cwd_allowlist,
    env_allowlist: patch.env_allowlist !== undefined ? patch.env_allowlist : cur.env_allowlist,
  };
  const now = Date.now();
  db.prepare(
    `UPDATE orchestration_execution_policies SET
       name = ?, adapter_kind = ?, cmd_allowlist = ?, cmd_denylist = ?, max_ms = ?, max_concurrent = ?,
       cwd_allowlist = ?, env_allowlist = ?, max_output_bytes = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.adapter_kind,
    JSON.stringify(next.cmd_allowlist),
    JSON.stringify(next.cmd_denylist),
    next.max_ms,
    next.max_concurrent,
    JSON.stringify(next.cwd_allowlist),
    next.env_allowlist === null ? null : JSON.stringify(next.env_allowlist),
    next.max_output_bytes,
    now,
    id
  );
  return getExecutionPolicyById(id);
}

export function setTeamExecutionPolicy(teamId: string, executionPolicyId: string | null): Team | null {
  const team = getTeamById(teamId);
  if (!team) return null;
  if (executionPolicyId !== null && !getExecutionPolicyById(executionPolicyId)) return null;
  const now = Date.now();
  db.prepare(`UPDATE orchestration_teams SET execution_policy_id = ?, updated_at = ? WHERE id = ?`).run(
    executionPolicyId,
    now,
    teamId
  );
  return getTeamById(teamId);
}

function migrateOrchestrationTaskRunsColumns(): void {
  const cols = db.prepare(`PRAGMA table_info(orchestration_task_runs)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('run_id')) {
    db.exec(`ALTER TABLE orchestration_task_runs ADD COLUMN run_id TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE orchestration_task_runs SET run_id = task_id WHERE run_id = '' OR run_id IS NULL`);
  }
  if (!names.has('termination_reason')) {
    db.exec(`ALTER TABLE orchestration_task_runs ADD COLUMN termination_reason TEXT`);
  }
  if (!names.has('attempt')) {
    db.exec(`ALTER TABLE orchestration_task_runs ADD COLUMN attempt INTEGER`);
  }
}

function streamTailLimitForTask(taskId: string): number {
  try {
    return streamTailCharBudget(resolveLocalProcessPolicyForTask(taskId));
  } catch {
    return 8000;
  }
}

/** Resolved `local_process` policy for a team (persisted row if linked, else env singleton). */
export function resolveLocalProcessPolicyForTeam(teamId: string): import('./environments/localProcessPolicy').LocalProcessPolicy {
  const team = getTeamById(teamId);
  if (team?.execution_policy_id) {
    const row = getExecutionPolicyById(team.execution_policy_id);
    if (row && row.adapter_kind === 'local_process') {
      return policyFromPersistedRecord(row);
    }
  }
  return getLocalProcessPolicy();
}

export function resolveLocalProcessPolicyForTask(taskId: string): import('./environments/localProcessPolicy').LocalProcessPolicy {
  const task = getTaskById(taskId);
  if (!task) return getLocalProcessPolicy();
  return resolveLocalProcessPolicyForTeam(task.team_id);
}

export function getEffectiveLocalProcessPolicyForTeam(teamId: string): EffectiveLocalProcessPolicy {
  const team = getTeamById(teamId);
  if (team?.execution_policy_id) {
    const row = getExecutionPolicyById(team.execution_policy_id);
    if (row && row.adapter_kind === 'local_process') {
      const p = policyFromPersistedRecord(row);
      return localProcessPolicyToEffective(p, {
        source: 'team_policy',
        policy_id: row.id,
        policy_name: row.name,
      });
    }
  }
  const p = getLocalProcessPolicy();
  return localProcessPolicyToEffective(p, { source: 'env_defaults' });
}

export function recordPreStartRejectedRun(input: {
  task_id: string;
  run_id: string;
  team_id: string;
  agent_id: string;
  environment_kind: string;
  error_message: string;
}): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO orchestration_task_runs (
       task_id, run_id, team_id, agent_id, environment_kind, status, attempt,
       stdout_tail, stderr_tail, stdout_bytes, stderr_bytes, exit_code, started_at, finished_at, error_message, termination_reason
     ) VALUES (?, ?, ?, ?, ?, 'policy_rejected', 0, '', '', 0, 0, NULL, ?, ?, ?, 'policy_rejected')
     ON CONFLICT(task_id) DO UPDATE SET
       run_id = excluded.run_id,
       team_id = excluded.team_id,
       agent_id = excluded.agent_id,
       environment_kind = excluded.environment_kind,
       status = 'policy_rejected',
       attempt = 0,
       stdout_tail = '',
       stderr_tail = '',
       stdout_bytes = 0,
       stderr_bytes = 0,
       exit_code = NULL,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       error_message = excluded.error_message,
       termination_reason = 'policy_rejected'`
  ).run(
    input.task_id,
    input.run_id,
    input.team_id,
    input.agent_id,
    input.environment_kind,
    now,
    now,
    input.error_message
  );
}

export function startTaskRun(input: {
  task_id: string;
  run_id: string;
  team_id: string;
  agent_id: string;
  environment_kind: string;
  /** 1-based workload attempt (defaults to 1). */
  attempt?: number;
}): void {
  const now = Date.now();
  const attempt = input.attempt != null && input.attempt > 0 ? input.attempt : 1;
  db.prepare(
    `INSERT INTO orchestration_task_runs (
       task_id, run_id, team_id, agent_id, environment_kind, status, attempt,
       stdout_tail, stderr_tail, stdout_bytes, stderr_bytes, exit_code, started_at, finished_at, error_message, termination_reason
     ) VALUES (?, ?, ?, ?, ?, 'running', ?, '', '', 0, 0, NULL, ?, NULL, NULL, NULL)
     ON CONFLICT(task_id) DO UPDATE SET
       run_id = excluded.run_id,
       team_id = excluded.team_id,
       agent_id = excluded.agent_id,
       environment_kind = excluded.environment_kind,
       status = 'running',
       attempt = excluded.attempt,
       stdout_tail = '',
       stderr_tail = '',
       stdout_bytes = 0,
       stderr_bytes = 0,
       exit_code = NULL,
       started_at = excluded.started_at,
       finished_at = NULL,
       error_message = NULL,
       termination_reason = NULL`
  ).run(input.task_id, input.run_id, input.team_id, input.agent_id, input.environment_kind, attempt, now);
}

export function appendTaskRunStream(taskId: string, stream: 'stdout' | 'stderr', chunk: string): void {
  if (!chunk) return;
  const tailBudget = streamTailLimitForTask(taskId);
  const policy = resolveLocalProcessPolicyForTask(taskId);
  const maxTotal = policy.maxOutputBytesTotal;

  const tailCol = stream === 'stdout' ? 'stdout_tail' : 'stderr_tail';
  const bytesCol = stream === 'stdout' ? 'stdout_bytes' : 'stderr_bytes';
  const row = db
    .prepare(
      `SELECT ${tailCol} as t, ${bytesCol} as b, stdout_bytes as sb, stderr_bytes as eb FROM orchestration_task_runs WHERE task_id = ?`
    )
    .get(taskId) as { t: string; b: number; sb: number; eb: number } | undefined;
  if (!row) return;
  const prevTotal = (row.sb ?? 0) + (row.eb ?? 0);
  if (prevTotal >= maxTotal) return;
  let take = chunk;
  const room = maxTotal - prevTotal;
  if (take.length > room) take = take.slice(0, room);
  const prev = row.t ?? '';
  const byteCount = (row.b ?? 0) + take.length;
  const merged = (prev + take).slice(-tailBudget);
  db.prepare(`UPDATE orchestration_task_runs SET ${tailCol} = ?, ${bytesCol} = ? WHERE task_id = ?`).run(
    merged,
    byteCount,
    taskId
  );
}

export function finalizeTaskRun(
  taskId: string,
  input: {
    status: TaskRunRecord['status'];
    exit_code?: number | null;
    error_message?: string | null;
    termination_reason?: string | null;
  }
): void {
  const now = Date.now();
  db.prepare(
    `UPDATE orchestration_task_runs SET status = ?, exit_code = ?, finished_at = ?, error_message = ?, termination_reason = ? WHERE task_id = ?`
  ).run(
    input.status,
    input.exit_code ?? null,
    now,
    input.error_message ?? null,
    input.termination_reason ?? null,
    taskId
  );
}

function rowToTaskRun(row: any): TaskRunRecord {
  return {
    task_id: row.task_id,
    run_id: row.run_id ?? row.task_id,
    team_id: row.team_id,
    agent_id: row.agent_id ?? undefined,
    environment_kind: row.environment_kind,
    status: row.status,
    attempt: row.attempt != null && row.attempt !== '' ? Number(row.attempt) : 1,
    stdout_tail: row.stdout_tail ?? '',
    stderr_tail: row.stderr_tail ?? '',
    stdout_bytes: row.stdout_bytes ?? 0,
    stderr_bytes: row.stderr_bytes ?? 0,
    exit_code: row.exit_code ?? null,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    error_message: row.error_message ?? null,
    termination_reason: row.termination_reason ?? null,
  };
}

export function recordTaskTransition(input: {
  team_id: string;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  agent_id?: string | null;
}): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO orchestration_task_transitions (team_id, task_id, from_status, to_status, agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.team_id,
    input.task_id,
    input.from_status,
    input.to_status,
    input.agent_id ?? null,
    now
  );
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createTeam(input: {
  name: string;
  description?: string;
  execution_policy_id?: string | null;
}): Team {
  const id = crypto.randomUUID();
  const now = Date.now();
  const pol = input.execution_policy_id ?? null;
  if (pol !== null && !getExecutionPolicyById(pol)) {
    throw new Error('invalid execution_policy_id');
  }
  db.prepare(
    `INSERT INTO orchestration_teams (id, name, description, execution_status, execution_policy_id, created_at, updated_at)
     VALUES (?, ?, ?, 'stopped', ?, ?, ?)`
  ).run(id, input.name, input.description ?? null, pol, now, now);
  return getTeamById(id)!;
}

export function updateTeam(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    execution_policy_id?: string | null;
  }
): Team | null {
  const cur = getTeamById(id);
  if (!cur) return null;
  if (patch.execution_policy_id !== undefined && patch.execution_policy_id !== null) {
    if (!getExecutionPolicyById(patch.execution_policy_id)) return null;
  }
  const name = patch.name ?? cur.name;
  const description = patch.description !== undefined ? patch.description : cur.description ?? null;
  const execution_policy_id =
    patch.execution_policy_id !== undefined ? patch.execution_policy_id : cur.execution_policy_id ?? null;
  const now = Date.now();
  db.prepare(
    `UPDATE orchestration_teams SET name = ?, description = ?, execution_policy_id = ?, updated_at = ? WHERE id = ?`
  ).run(name, description, execution_policy_id, now, id);
  return getTeamById(id);
}

export function listTeams(): Team[] {
  const rows = db.prepare(`SELECT * FROM orchestration_teams ORDER BY created_at DESC`).all() as any[];
  return rows.map(rowToTeam);
}

export function getTeamById(id: string): Team | null {
  const row = db.prepare(`SELECT * FROM orchestration_teams WHERE id = ?`).get(id) as any;
  return row ? rowToTeam(row) : null;
}

export function deleteTeam(id: string): boolean {
  const result = db.prepare(`DELETE FROM orchestration_teams WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function setTeamExecutionStatus(id: string, status: TeamExecutionStatus): Team | null {
  const now = Date.now();
  const result = db
    .prepare(`UPDATE orchestration_teams SET execution_status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now, id);
  if (result.changes === 0) return null;
  return getTeamById(id);
}

function rowToTeam(row: any): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    execution_status: row.execution_status as TeamExecutionStatus,
    execution_policy_id: row.execution_policy_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createAgent(input: {
  team_id: string;
  name: string;
  role: string;
  environment_kind?: string;
  metadata?: Record<string, unknown>;
}): Agent | null {
  if (!getTeamById(input.team_id)) return null;
  const id = crypto.randomUUID();
  const now = Date.now();
  const meta = JSON.stringify(input.metadata ?? {});
  db.prepare(
    `INSERT INTO orchestration_agents (id, team_id, name, role, status, environment_kind, current_task_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'idle', ?, NULL, ?, ?, ?)`
  ).run(
    id,
    input.team_id,
    input.name,
    input.role,
    input.environment_kind ?? 'simulated',
    meta,
    now,
    now
  );
  return getAgentById(id);
}

export function listAgentsByTeam(teamId: string): Agent[] {
  const rows = db
    .prepare(`SELECT * FROM orchestration_agents WHERE team_id = ? ORDER BY created_at ASC`)
    .all(teamId) as any[];
  return rows.map(rowToAgent);
}

export function getAgentById(id: string): Agent | null {
  const row = db.prepare(`SELECT * FROM orchestration_agents WHERE id = ?`).get(id) as any;
  return row ? rowToAgent(row) : null;
}

export function updateAgent(
  id: string,
  patch: Partial<Pick<Agent, 'status' | 'current_task_id' | 'metadata' | 'role'>>
): Agent | null {
  const existing = getAgentById(id);
  if (!existing) return null;
  const now = Date.now();
  const status = patch.status ?? existing.status;
  const current_task_id = patch.current_task_id !== undefined ? patch.current_task_id : existing.current_task_id;
  const role = patch.role ?? existing.role;
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
  db.prepare(
    `UPDATE orchestration_agents SET status = ?, current_task_id = ?, role = ?, metadata = ?, updated_at = ? WHERE id = ?`
  ).run(status, current_task_id ?? null, role, JSON.stringify(metadata), now, id);
  return getAgentById(id);
}

function rowToAgent(row: any): Agent {
  return {
    id: row.id,
    team_id: row.team_id,
    name: row.name,
    role: row.role,
    status: row.status as AgentStatus,
    environment_kind: row.environment_kind,
    current_task_id: row.current_task_id ?? undefined,
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createTask(input: {
  team_id: string;
  title: string;
  description?: string;
  priority?: number;
  status?: TaskStatus;
  payload?: Record<string, unknown>;
}): Task | null {
  if (!getTeamById(input.team_id)) return null;
  const id = crypto.randomUUID();
  const now = Date.now();
  const status = input.status ?? 'backlog';
  db.prepare(
    `INSERT INTO orchestration_tasks (id, team_id, title, description, status, priority, assignee_agent_id, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    input.team_id,
    input.title,
    input.description ?? null,
    status,
    input.priority ?? 0,
    JSON.stringify(input.payload ?? {}),
    now,
    now
  );
  const created = getTaskById(id);
  if (created) {
    recordTaskTransition({
      team_id: created.team_id,
      task_id: created.id,
      from_status: null,
      to_status: created.status,
      agent_id: created.assignee_agent_id ?? null,
    });
  }
  return created;
}

export function listTasksByTeam(teamId: string, status?: TaskStatus): Task[] {
  let sql = `SELECT * FROM orchestration_tasks WHERE team_id = ?`;
  const params: any[] = [teamId];
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY priority DESC, created_at ASC`;
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(rowToTask);
}

export function getTaskById(id: string): Task | null {
  const row = db.prepare(`SELECT * FROM orchestration_tasks WHERE id = ?`).get(id) as any;
  return row ? rowToTask(row) : null;
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'status' | 'priority' | 'assignee_agent_id' | 'title' | 'description' | 'payload'>> & {
    assignee_agent_id?: string | null;
  }
): Task | null {
  const existing = getTaskById(id);
  if (!existing) return null;
  const now = Date.now();
  const nextAssignee =
    'assignee_agent_id' in patch ? (patch.assignee_agent_id === null ? undefined : patch.assignee_agent_id) : existing.assignee_agent_id;
  const next = {
    title: patch.title ?? existing.title,
    description: patch.description !== undefined ? patch.description : existing.description,
    status: patch.status ?? existing.status,
    priority: patch.priority ?? existing.priority,
    assignee_agent_id: nextAssignee,
    payload: patch.payload !== undefined ? patch.payload : existing.payload,
  };
  if (next.status !== existing.status) {
    recordTaskTransition({
      team_id: existing.team_id,
      task_id: id,
      from_status: existing.status,
      to_status: next.status,
      agent_id: next.assignee_agent_id ?? null,
    });
  }
  db.prepare(
    `UPDATE orchestration_tasks SET title = ?, description = ?, status = ?, priority = ?, assignee_agent_id = ?, payload = ?, updated_at = ? WHERE id = ?`
  ).run(
    next.title,
    next.description ?? null,
    next.status,
    next.priority,
    next.assignee_agent_id ?? null,
    JSON.stringify(next.payload),
    now,
    id
  );
  return getTaskById(id);
}

function taskRetryView(payload: Record<string, unknown>): Task['retry'] {
  const m = getRetryMetaFromPayload(payload);
  if (!m) return undefined;
  return {
    attempt: m.attempt,
    max_attempts: m.max_attempts,
    next_retry_at: m.next_retry_at,
    last_failure_class: m.last_failure_class,
  };
}

function rowToTask(row: any): Task {
  const payload = parseJson<Record<string, unknown>>(row.payload, {});
  return {
    id: row.id,
    team_id: row.team_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority,
    assignee_agent_id: row.assignee_agent_id ?? undefined,
    payload,
    retry: taskRetryView(payload),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function insertMessage(input: {
  team_id: string;
  direction: OrchestrationMessage['direction'];
  from_agent_id?: string;
  to_agent_id?: string;
  body: string;
  kind: OrchestrationMessage['kind'];
  correlation_task_id?: string;
}): OrchestrationMessage {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO orchestration_messages (team_id, direction, from_agent_id, to_agent_id, body, kind, correlation_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.team_id,
      input.direction,
      input.from_agent_id ?? null,
      input.to_agent_id ?? null,
      input.body,
      input.kind,
      input.correlation_task_id ?? null,
      now
    );
  const row = db.prepare(`SELECT * FROM orchestration_messages WHERE id = ?`).get(result.lastInsertRowid) as any;
  return rowToMessage(row);
}

export function listMessages(teamId: string, limit = 200): OrchestrationMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM orchestration_messages WHERE team_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(teamId, limit) as any[];
  return rows.map(rowToMessage).reverse();
}

function rowToMessage(row: any): OrchestrationMessage {
  return {
    id: row.id,
    team_id: row.team_id,
    direction: row.direction,
    from_agent_id: row.from_agent_id ?? undefined,
    to_agent_id: row.to_agent_id ?? undefined,
    body: row.body,
    kind: row.kind,
    correlation_task_id: row.correlation_task_id ?? undefined,
    created_at: row.created_at,
  };
}

export function recordMetric(input: {
  team_id: string;
  agent_id?: string;
  key: string;
  value: number;
  unit: string;
}): OrchestrationMetric {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO orchestration_metrics (team_id, agent_id, key, value, unit, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.team_id, input.agent_id ?? null, input.key, input.value, input.unit, now);
  return db.prepare(`SELECT * FROM orchestration_metrics WHERE id = ?`).get(result.lastInsertRowid) as OrchestrationMetric;
}

export function listMetrics(teamId: string, limit = 500): OrchestrationMetric[] {
  const rows = db
    .prepare(`SELECT * FROM orchestration_metrics WHERE team_id = ? ORDER BY recorded_at DESC LIMIT ?`)
    .all(teamId, limit) as any[];
  return rows.map(rowToMetric).reverse();
}

function rowToMetric(row: any): OrchestrationMetric {
  return {
    id: row.id,
    team_id: row.team_id,
    agent_id: row.agent_id ?? undefined,
    key: row.key,
    value: row.value,
    unit: row.unit,
    recorded_at: row.recorded_at,
  };
}

function countTasksByStatus(teamId: string): Record<TaskStatus, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) as c FROM orchestration_tasks WHERE team_id = ? GROUP BY status`)
    .all(teamId) as { status: string; c: number }[];
  const base: Record<TaskStatus, number> = {
    backlog: 0,
    queued: 0,
    running: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    timed_out: 0,
  };
  for (const r of rows) {
    base[r.status as TaskStatus] = r.c;
  }
  return base;
}

export function getTeamSummaries(): TeamSummary[] {
  const teams = listTeams();
  return teams.map((t) => ({
    ...t,
    agent_count: (db.prepare(`SELECT COUNT(*) as c FROM orchestration_agents WHERE team_id = ?`).get(t.id) as any).c,
    task_counts: countTasksByStatus(t.id),
  }));
}

export type AdminAuditListFilter = {
  limit?: number;
  outcome?: string;
  action?: string;
  /** Exact path match (e.g. /api/orchestration/policies). */
  route?: string;
  target_entity_type?: string;
  target_entity_id?: string;
};

function rowToAdminAuditRecord(row: any): AdminAuditRecord {
  return {
    id: row.id,
    created_at: row.created_at,
    route: row.route,
    method: row.method,
    action: row.action,
    target_entity_type: row.target_entity_type ?? null,
    target_entity_id: row.target_entity_id ?? null,
    outcome: row.outcome,
    auth_mode: row.auth_mode,
    client_ip: row.client_ip ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  };
}

export function insertAdminAuditRecord(row: {
  id: string;
  created_at: number;
  route: string;
  method: string;
  action: string;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
  outcome: AdminAuditRecord['outcome'];
  auth_mode: AdminAuditRecord['auth_mode'];
  client_ip?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(
    `INSERT INTO orchestration_admin_audit_log (
      id, created_at, route, method, action, target_entity_type, target_entity_id,
      outcome, auth_mode, client_ip, metadata
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    row.id,
    row.created_at,
    row.route,
    row.method,
    row.action,
    row.target_entity_type ?? null,
    row.target_entity_id ?? null,
    row.outcome,
    row.auth_mode,
    row.client_ip ?? null,
    JSON.stringify(row.metadata ?? {})
  );
}

export function listAdminAuditRecords(filter: AdminAuditListFilter = {}): AdminAuditRecord[] {
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.outcome) {
    conditions.push('outcome = ?');
    params.push(filter.outcome);
  }
  if (filter.action) {
    conditions.push('action = ?');
    params.push(filter.action);
  }
  if (filter.route) {
    conditions.push('route = ?');
    params.push(filter.route);
  }
  if (filter.target_entity_type) {
    conditions.push('target_entity_type = ?');
    params.push(filter.target_entity_type);
  }
  if (filter.target_entity_id) {
    conditions.push('target_entity_id = ?');
    params.push(filter.target_entity_id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM orchestration_admin_audit_log ${where} ORDER BY created_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...([...params, limit] as any[])) as any[];
  return rows.map(rowToAdminAuditRecord);
}

/** Count all admin audit rows (for tests / diagnostics). */
export function countAdminAuditRecords(): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM orchestration_admin_audit_log`).get() as { c: number };
  return Number(row.c);
}

/**
 * Prune admin audit log. When both maxDays and maxRows are set: **age deletion runs first**,
 * then row-cap trims so at most maxRows oldest rows remain (by `created_at`).
 */
export function pruneOrchestrationAdminAudit(maxDays?: number, maxRows?: number): {
  removed_by_age: number;
  removed_by_row_cap: number;
} {
  let removed_by_age = 0;
  let removed_by_row_cap = 0;
  const days = maxDays != null && maxDays > 0 ? maxDays : null;
  const rowsCap = maxRows != null && maxRows > 0 ? maxRows : null;

  if (days != null) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    removed_by_age = db.prepare(`DELETE FROM orchestration_admin_audit_log WHERE created_at < ?`).run(cutoff).changes;
  }
  if (rowsCap != null) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM orchestration_admin_audit_log`).get() as { c: number };
    const total = Number(row.c);
    if (total > rowsCap) {
      const excess = total - rowsCap;
      removed_by_row_cap = db
        .prepare(
          `DELETE FROM orchestration_admin_audit_log WHERE id IN (
            SELECT id FROM orchestration_admin_audit_log ORDER BY created_at ASC LIMIT ?
          )`
        )
        .run(excess).changes;
    }
  }
  return { removed_by_age, removed_by_row_cap };
}

/**
 * Prune completed task run rows (`orchestration_task_runs` is one row per task_id; see technical design).
 * Only terminal rows with non-null `finished_at` are eligible. **Never** deletes `pending` / `running`.
 * Precedence when both limits set: **age first**, then global row cap on prunable rows (oldest `finished_at` first).
 */
export function pruneOrchestrationTaskRuns(maxDays?: number, maxRows?: number): {
  removed_by_age: number;
  removed_by_row_cap: number;
} {
  let removed_by_age = 0;
  let removed_by_row_cap = 0;
  const days = maxDays != null && maxDays > 0 ? maxDays : null;
  const rowsCap = maxRows != null && maxRows > 0 ? maxRows : null;

  const prunable = `status IN ('completed','failed','cancelled','timed_out','policy_rejected')`;

  if (days != null) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    removed_by_age = db
      .prepare(
        `DELETE FROM orchestration_task_runs
         WHERE finished_at IS NOT NULL AND finished_at < ?
           AND ${prunable}`
      )
      .run(cutoff).changes;
  }
  if (rowsCap != null) {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM orchestration_task_runs
         WHERE finished_at IS NOT NULL AND ${prunable}`
      )
      .get() as { c: number };
    const total = Number(row.c);
    if (total > rowsCap) {
      const excess = total - rowsCap;
      removed_by_row_cap = db
        .prepare(
          `DELETE FROM orchestration_task_runs WHERE task_id IN (
            SELECT task_id FROM orchestration_task_runs
            WHERE finished_at IS NOT NULL AND ${prunable}
            ORDER BY finished_at ASC LIMIT ?
          )`
        )
        .run(excess).changes;
    }
  }
  return { removed_by_age, removed_by_row_cap };
}

export function getOrchestrationSnapshot(): OrchestrationSnapshot {
  const teams = listTeams();
  const team_summaries = getTeamSummaries();
  const agents = db.prepare(`SELECT * FROM orchestration_agents ORDER BY team_id, created_at`).all() as any[];
  const tasks = db.prepare(`SELECT * FROM orchestration_tasks ORDER BY updated_at DESC LIMIT 800`).all() as any[];
  const messages = db
    .prepare(`SELECT * FROM orchestration_messages ORDER BY id DESC LIMIT 400`)
    .all() as any[];
  const metrics = db.prepare(`SELECT * FROM orchestration_metrics ORDER BY id DESC LIMIT 400`).all() as any[];
  const task_transitions = db
    .prepare(`SELECT * FROM orchestration_task_transitions ORDER BY id DESC LIMIT 500`)
    .all() as any[];
  const taskRows = tasks as any[];
  const taskIds = taskRows.map((r) => r.id as string);
  let task_runs: TaskRunRecord[] = [];
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    const runRows = db
      .prepare(`SELECT * FROM orchestration_task_runs WHERE task_id IN (${placeholders})`)
      .all(...taskIds) as any[];
    task_runs = runRows.map(rowToTaskRun);
  }
  return {
    teams,
    team_summaries,
    agents: agents.map(rowToAgent),
    tasks: tasks.map(rowToTask),
    messages: messages.map(rowToMessage).reverse(),
    metrics: metrics.map(rowToMetric).reverse(),
    task_transitions: task_transitions.map(rowToTaskTransition).reverse(),
    task_runs,
    execution_policies: listExecutionPolicies(),
    execution_environment_kind: getExecutionEnvironmentKind(),
  };
}

function rowToTaskTransition(row: any): TaskTransition {
  return {
    id: row.id,
    team_id: row.team_id,
    task_id: row.task_id,
    from_status: row.from_status ? (row.from_status as TaskStatus) : null,
    to_status: row.to_status as TaskStatus,
    agent_id: row.agent_id ?? undefined,
    created_at: row.created_at,
  };
}

/** Move backlog tasks to queued when execution starts (MVP policy). */
export function enqueueBacklogTasks(teamId: string): void {
  const rows = db
    .prepare(`SELECT id FROM orchestration_tasks WHERE team_id = ? AND status = 'backlog'`)
    .all(teamId) as { id: string }[];
  for (const { id } of rows) {
    updateTask(id, { status: 'queued' });
  }
}

export function resetAgentsForStop(teamId: string): void {
  const now = Date.now();
  db.prepare(
    `UPDATE orchestration_agents SET status = 'idle', current_task_id = NULL, updated_at = ? WHERE team_id = ? AND status = 'running'`
  ).run(now, teamId);
}

/** Best-effort: mark tasks still `running` after stop so worker completions have a consistent baseline; run metadata finalized in adapter callbacks. */
export function sweepRunningTasksForEngineStop(teamId: string): void {
  const rows = db
    .prepare(`SELECT id FROM orchestration_tasks WHERE team_id = ? AND status = 'running'`)
    .all(teamId) as { id: string }[];
  for (const { id } of rows) {
    updateTask(id, { status: 'cancelled', assignee_agent_id: undefined });
  }
}
