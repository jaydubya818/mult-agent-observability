export type TeamExecutionStatus = 'stopped' | 'running';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export type TaskStatus =
  | 'backlog'
  | 'queued'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type MessageDirection = 'orchestrator_to_agent' | 'agent_to_orchestrator' | 'broadcast';

export type MessageKind = 'directive' | 'report' | 'system';

export type RetryJitterMode = 'off' | 'uniform';

export type RetryResolutionSource = 'team' | 'policy' | 'env' | 'default';

/** Effective retry config with per-field resolution trail (server truth). */
export interface ResolvedTaskRetryConfig {
  max_attempts: number;
  backoff_ms: number;
  max_backoff_ms: number | null;
  jitter: RetryJitterMode;
  resolution: {
    max_attempts: RetryResolutionSource;
    backoff_ms: RetryResolutionSource;
    max_backoff_ms: RetryResolutionSource;
    jitter: RetryResolutionSource;
  };
}

/** Persisted guardrails for local_process (server truth). */
export interface ExecutionPolicy {
  id: string;
  name: string;
  adapter_kind: string;
  cmd_allowlist: string[] | null;
  cmd_denylist: string[];
  max_ms: number;
  max_concurrent: number;
  cwd_allowlist: string[];
  env_allowlist: string[] | null;
  max_output_bytes: number;
  retry_max_attempts: number | null;
  retry_backoff_ms: number | null;
  retry_max_backoff_ms: number | null;
  retry_jitter: RetryJitterMode | null;
  created_at: number;
  updated_at: number;
}

export interface OrchestrationTeam {
  id: string;
  name: string;
  description?: string;
  execution_status: TeamExecutionStatus;
  execution_policy_id?: string | null;
  retry_max_attempts: number | null;
  retry_backoff_ms: number | null;
  retry_max_backoff_ms: number | null;
  retry_jitter: RetryJitterMode | null;
  /** Resolved team → policy → env → default (for operators). */
  resolved_retry: ResolvedTaskRetryConfig;
  created_at: number;
  updated_at: number;
}

export interface OrchestrationAgent {
  id: string;
  team_id: string;
  name: string;
  role: string;
  status: AgentStatus;
  environment_kind: string;
  current_task_id?: string;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface TaskRetryState {
  attempt: number;
  next_retry_at?: number;
  last_failure_class?: string;
  effective: ResolvedTaskRetryConfig;
}

export interface OrchestrationTask {
  id: string;
  team_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  assignee_agent_id?: string;
  payload: Record<string, unknown>;
  retry_attempt: number;
  retry_next_at: number | null;
  retry_last_failure_class: string | null;
  retry?: TaskRetryState;
  created_at: number;
  updated_at: number;
}

export interface OrchestrationMessage {
  id: number;
  team_id: string;
  direction: MessageDirection;
  from_agent_id?: string;
  to_agent_id?: string;
  body: string;
  kind: MessageKind;
  correlation_task_id?: string;
  created_at: number;
}

export interface OrchestrationMetric {
  id: number;
  team_id: string;
  agent_id?: string;
  key: string;
  value: number;
  unit: string;
  recorded_at: number;
}

export interface TeamSummary extends OrchestrationTeam {
  agent_count: number;
  task_counts: Record<TaskStatus, number>;
}

export interface TaskTransition {
  id: number;
  team_id: string;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  agent_id?: string;
  created_at: number;
}

export type TaskRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'policy_rejected';

export interface TaskRunRecord {
  task_id: string;
  run_id: string;
  team_id: string;
  agent_id?: string;
  environment_kind: string;
  status: TaskRunStatus;
  /** 1-based execution attempt for this run (mirrors server). */
  attempt: number;
  stdout_tail: string;
  stderr_tail: string;
  stdout_bytes: number;
  stderr_bytes: number;
  exit_code: number | null;
  started_at: number | null;
  finished_at: number | null;
  error_message: string | null;
  /** user_cancelled | engine_stopped | policy_rejected | timed_out | process_error | success */
  termination_reason: string | null;
}

/** Archived terminal run (GET /api/orchestration/task-runs). */
export interface TaskRunHistoryRecord extends TaskRunRecord {
  history_id: number;
  recorded_at: number;
}

/** Admin mutation audit (server; no secrets in rows). */
export interface AdminAuditRecord {
  id: string;
  created_at: number;
  route: string;
  method: string;
  action: string;
  target_entity_type: string | null;
  target_entity_id: string | null;
  outcome: 'success' | 'denied' | 'invalid';
  auth_mode: 'open_mode' | 'token';
  client_ip: string | null;
  metadata: Record<string, unknown>;
}

export interface OrchestrationSnapshot {
  teams: OrchestrationTeam[];
  team_summaries: TeamSummary[];
  agents: OrchestrationAgent[];
  tasks: OrchestrationTask[];
  messages: OrchestrationMessage[];
  metrics: OrchestrationMetric[];
  task_transitions: TaskTransition[];
  task_runs: TaskRunRecord[];
  execution_policies: ExecutionPolicy[];
  execution_environment_kind: string;
}
