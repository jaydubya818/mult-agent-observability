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

/** Persisted execution guardrails for an adapter (e.g. `local_process`). */
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
  created_at: number;
  updated_at: number;
}

/** JSON-serializable resolved policy for admin/inspection (no `Set`). */
export type EffectiveLocalProcessPolicy = {
  source: 'team_policy' | 'env_defaults';
  policy_id?: string;
  policy_name?: string;
  cmd_allowlist: string[] | null;
  cmd_denylist: string[];
  max_ms: number;
  max_concurrent: number;
  cwd_allowlist: string[];
  env_allowlist: string[] | null;
  max_output_bytes: number;
};

export interface Team {
  id: string;
  name: string;
  description?: string;
  execution_status: TeamExecutionStatus;
  /** When set, `local_process` uses this persisted policy instead of `ORCH_LP_*` alone. */
  execution_policy_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Agent {
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

export interface Task {
  id: string;
  team_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  assignee_agent_id?: string;
  payload: Record<string, unknown>;
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

export interface TeamSummary extends Team {
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
  stdout_tail: string;
  stderr_tail: string;
  stdout_bytes: number;
  stderr_bytes: number;
  exit_code: number | null;
  started_at: number | null;
  finished_at: number | null;
  error_message: string | null;
  /** e.g. user_cancelled, engine_stopped, policy_rejected, timed_out */
  termination_reason: string | null;
}

export interface OrchestrationSnapshot {
  teams: Team[];
  team_summaries: TeamSummary[];
  agents: Agent[];
  tasks: Task[];
  messages: OrchestrationMessage[];
  metrics: OrchestrationMetric[];
  task_transitions: TaskTransition[];
  task_runs: TaskRunRecord[];
  /** Persisted execution policies (for UI name lookup; typically small). */
  execution_policies: ExecutionPolicy[];
  /** Active server execution adapter (`simulated` | `local_process`, …). */
  execution_environment_kind: string;
}

/** Orchestration admin / config mutation audit (no secrets or raw tokens). */
export type AdminAuditOutcome = 'success' | 'denied' | 'invalid';

export interface AdminAuditRecord {
  id: string;
  created_at: number;
  route: string;
  method: string;
  action: string;
  target_entity_type: string | null;
  target_entity_id: string | null;
  outcome: AdminAuditOutcome;
  auth_mode: 'open_mode' | 'token';
  client_ip: string | null;
  metadata: Record<string, unknown>;
}

export const ORCHESTRATION_HOOK_SOURCE = 'orchestration';

export const OrchestrationHookEvents = {
  TeamStarted: 'OrchestrationTeamStarted',
  TeamStopped: 'OrchestrationTeamStopped',
  TaskAssigned: 'OrchestrationTaskAssigned',
  TaskCompleted: 'OrchestrationTaskCompleted',
  TaskFailed: 'OrchestrationTaskFailed',
  ExecutionStarted: 'OrchestrationExecutionStarted',
  ExecutionCompleted: 'OrchestrationExecutionCompleted',
  ExecutionFailed: 'OrchestrationExecutionFailed',
  ExecutionCancelled: 'OrchestrationExecutionCancelled',
  ExecutionTimedOut: 'OrchestrationExecutionTimedOut',
  ExecutionPolicyRejected: 'OrchestrationExecutionPolicyRejected',
  TaskCancelled: 'OrchestrationTaskCancelled',
  TaskTimedOut: 'OrchestrationTaskTimedOut',
  AgentStatus: 'OrchestrationAgentStatus',
  Message: 'OrchestrationMessage',
  Metric: 'OrchestrationMetric',
} as const;

export type OrchestrationHookEventType =
  (typeof OrchestrationHookEvents)[keyof typeof OrchestrationHookEvents];
