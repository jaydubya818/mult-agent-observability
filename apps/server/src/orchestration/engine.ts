import { insertEvent } from '../db';
import type { HookEvent } from '../types';
import type { ExecutionEnvironment, WorkloadTerminalKind } from './environments/executionEnvironment';
import { SimulatedEnvironment } from './environments/simulatedEnvironment';
import {
  appendTaskRunStream,
  enqueueBacklogTasks,
  finalizeTaskRun,
  getAgentById,
  getTaskById,
  getTeamById,
  listAgentsByTeam,
  listTasksByTeam,
  recordMetric,
  recordPreStartRejectedRun,
  resetAgentsForStop,
  resolveRetryConfigForTeamId,
  setTeamExecutionStatus,
  sweepRunningTasksForEngineStop,
  startTaskRun,
  updateAgent,
  updateTask,
} from './repository';
import {
  computeRetryDelayWithPolicy,
  isRetryableTerminal,
  stripLegacyRetryFromPayload,
  taskQueuedAndReadyForDispatch,
} from './retryPolicy';
import { ORCHESTRATION_HOOK_SOURCE, OrchestrationHookEvents, type Task } from './types';

type TeamRuntime = {
  timer: ReturnType<typeof setInterval> | null;
  abort: boolean;
  rrIndex: number;
  activeRuns: Map<string, { cancel: () => void }>;
};

export interface OrchestrationEngineOptions {
  onStateChange: () => void;
  onHookEvent?: (event: HookEvent) => void;
  pollMs?: number;
  environment?: ExecutionEnvironment;
}

function terminalFromResult(
  error: Error | undefined,
  result: { terminalKind?: WorkloadTerminalKind } | undefined
): WorkloadTerminalKind {
  if (result?.terminalKind) return result.terminalKind;
  if (error) return 'process_error';
  return 'success';
}

export class OrchestrationEngine {
  private readonly env: ExecutionEnvironment;
  private readonly pollMs: number;
  private readonly onStateChange: () => void;
  private readonly onHookEvent?: (event: HookEvent) => void;
  private readonly runtimes = new Map<string, TeamRuntime>();
  private readonly userCancelledTaskIds = new Set<string>();
  private notifyFlush: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: OrchestrationEngineOptions) {
    this.env = opts.environment ?? new SimulatedEnvironment();
    this.pollMs = opts.pollMs ?? 400;
    this.onStateChange = opts.onStateChange;
    this.onHookEvent = opts.onHookEvent;
  }

  startTeam(teamId: string): void {
    const team = getTeamById(teamId);
    if (!team) return;

    enqueueBacklogTasks(teamId);
    setTeamExecutionStatus(teamId, 'running');

    const runtime: TeamRuntime = {
      timer: null,
      abort: false,
      rrIndex: 0,
      activeRuns: new Map(),
    };
    this.runtimes.set(teamId, runtime);

    this.emitHook(teamId, OrchestrationHookEvents.TeamStarted, {
      team_id: teamId,
      environment: this.env.kind,
      adapter_kind: this.env.kind,
    });
    recordMetric({ team_id: teamId, key: 'execution_started', value: 1, unit: 'count' });

    this.notify();

    runtime.timer = setInterval(() => {
      this.tick(teamId).catch((err) => console.error('[orchestration] tick', err));
    }, this.pollMs);
  }

  stopTeam(teamId: string): void {
    const runtime = this.runtimes.get(teamId);
    if (runtime) {
      runtime.abort = true;
    }
    if (runtime?.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
    if (runtime) {
      for (const c of runtime.activeRuns.values()) {
        c.cancel();
      }
      runtime.activeRuns.clear();
    }
    this.runtimes.delete(teamId);

    sweepRunningTasksForEngineStop(teamId);
    resetAgentsForStop(teamId);
    setTeamExecutionStatus(teamId, 'stopped');

    this.emitHook(teamId, OrchestrationHookEvents.TeamStopped, {
      team_id: teamId,
      adapter_kind: this.env.kind,
    });
    recordMetric({ team_id: teamId, key: 'execution_stopped', value: 1, unit: 'count' });
    this.notify();
  }

  isRunning(teamId: string): boolean {
    return this.runtimes.has(teamId);
  }

  cancelTask(taskId: string): boolean {
    const task = getTaskById(taskId);
    if (!task || task.status !== 'running' || !task.assignee_agent_id) return false;
    const runtime = this.runtimes.get(task.team_id);
    if (!runtime) return false;
    const handle = runtime.activeRuns.get(task.assignee_agent_id);
    if (!handle) return false;
    this.userCancelledTaskIds.add(taskId);
    handle.cancel();
    return true;
  }

  private scheduleNotify(): void {
    if (this.notifyFlush) return;
    this.notifyFlush = setTimeout(() => {
      this.notifyFlush = null;
      this.notify();
    }, 200);
  }

  private notify(): void {
    try {
      this.onStateChange();
    } catch (e) {
      console.error('[orchestration] onStateChange', e);
    }
  }

  private emitHook(teamId: string, hook_event_type: string, payload: Record<string, unknown>): void {
    const event: HookEvent = {
      source_app: ORCHESTRATION_HOOK_SOURCE,
      session_id: teamId,
      hook_event_type,
      payload,
      timestamp: Date.now(),
    };
    const saved = insertEvent(event);
    try {
      this.onHookEvent?.(saved);
    } catch (e) {
      console.error('[orchestration] onHookEvent', e);
    }
  }

  private pickAgents(teamId: string) {
    const agents = listAgentsByTeam(teamId);
    return agents.filter((a) => a.status === 'idle' && !this.runtimes.get(teamId)?.activeRuns.has(a.id));
  }

  private pickTasks(teamId: string): Task[] {
    return listTasksByTeam(teamId, 'queued').filter((t) => taskQueuedAndReadyForDispatch(t));
  }

  private tryScheduleRetryAfterFailure(input: {
    teamId: string;
    taskId: string;
    agentId: string;
    terminal: WorkloadTerminalKind;
    runId: string;
    executionStarted: boolean;
  }): boolean {
    if (!input.executionStarted) return false;
    if (!isRetryableTerminal(input.terminal)) return false;

    const cfg = resolveRetryConfigForTeamId(input.teamId);
    const taskNow = getTaskById(input.taskId);
    if (!taskNow) return false;
    const currentAttempt = taskNow.retry_attempt > 0 ? taskNow.retry_attempt : 1;

    if (currentAttempt >= cfg.max_attempts) {
      if (cfg.max_attempts > 1) {
        this.emitHook(input.teamId, OrchestrationHookEvents.TaskRetryExhausted, {
          team_id: input.teamId,
          task_id: input.taskId,
          agent_id: input.agentId,
          run_id: input.runId,
          attempt: currentAttempt,
          max_attempts: cfg.max_attempts,
          failure_class: input.terminal,
          retry_config: cfg,
          adapter_kind: this.env.kind,
          correlation_task_id: input.taskId,
        });
        recordMetric({ team_id: input.teamId, key: 'tasks_retry_exhausted', value: 1, unit: 'count' });
      }
      return false;
    }

    const delay = computeRetryDelayWithPolicy(currentAttempt, cfg);
    const nextAt = Date.now() + delay;

    updateAgent(input.agentId, { status: 'idle', current_task_id: undefined });
    updateTask(input.taskId, {
      status: 'queued',
      assignee_agent_id: undefined,
      retry_next_at: nextAt,
      retry_last_failure_class: input.terminal,
    });

    this.emitHook(input.teamId, OrchestrationHookEvents.TaskRetryScheduled, {
      team_id: input.teamId,
      task_id: input.taskId,
      agent_id: input.agentId,
      run_id: input.runId,
      attempt: currentAttempt,
      max_attempts: cfg.max_attempts,
      next_retry_at: nextAt,
      backoff_ms: delay,
      failure_class: input.terminal,
      retry_config: cfg,
      adapter_kind: this.env.kind,
      correlation_task_id: input.taskId,
    });
    recordMetric({ team_id: input.teamId, key: 'tasks_retry_scheduled', value: 1, unit: 'count' });
    return true;
  }

  private async tick(teamId: string): Promise<void> {
    const runtime = this.runtimes.get(teamId);
    if (!runtime || runtime.abort) return;

    const queued = this.pickTasks(teamId);
    const idleAgents = this.pickAgents(teamId);
    if (!idleAgents.length || !queued.length) {
      recordMetric({ team_id: teamId, key: 'queue_depth', value: queued.length, unit: 'count' });
      recordMetric({
        team_id: teamId,
        key: 'parallel_active',
        value: runtime.activeRuns.size,
        unit: 'count',
      });
      return;
    }

    const tasksSorted = [...queued].sort((a, b) => b.priority - a.priority || a.created_at - b.created_at);

    let idx = runtime.rrIndex;
    for (const task of tasksSorted) {
      const freshIdle = this.pickAgents(teamId);
      if (!freshIdle.length) break;

      const agentsSorted = [...freshIdle].sort((a, b) => a.created_at - b.created_at);

      const agent = agentsSorted[idx % agentsSorted.length];
      idx++;
      if (agent === undefined) break;
      if (runtime.activeRuns.has(agent.id)) continue;

      const freshAgent = getAgentById(agent.id);
      const freshTask = getTaskById(task.id);
      if (!freshAgent || !freshTask) continue;
      if (freshTask.status !== 'queued' || freshAgent.status !== 'idle') continue;

      updateTask(task.id, { status: 'running', assignee_agent_id: agent.id });
      updateAgent(agent.id, { status: 'running', current_task_id: task.id });

      const runId = crypto.randomUUID();

      this.emitHook(teamId, OrchestrationHookEvents.TaskAssigned, {
        team_id: teamId,
        task_id: task.id,
        agent_id: agent.id,
        run_id: runId,
        adapter_kind: this.env.kind,
        correlation_task_id: task.id,
      });

      const estimatedMs = 700 + Math.min(2500, (task.priority + 1) * 350);
      let executionStarted = false;

      const run = this.env.runWorkload(
        {
          teamId,
          agentId: agent.id,
          taskId: task.id,
          runId,
          estimatedDurationMs: estimatedMs,
          taskPayload: freshTask.payload,
          resolveCancellationKind: () => {
            if (this.userCancelledTaskIds.has(task.id)) return 'user';
            if (runtime.abort) return 'engine';
            return 'engine';
          },
        },
        {
          onBegin: () => {
            executionStarted = true;
            const t = getTaskById(task.id);
            const prevAttempt = t?.retry_attempt ?? 0;
            const nextAttempt = prevAttempt + 1;
            updateTask(task.id, {
              retry_attempt: nextAttempt,
              retry_next_at: null,
            });
            startTaskRun({
              task_id: task.id,
              run_id: runId,
              team_id: teamId,
              agent_id: agent.id,
              environment_kind: this.env.kind,
              attempt: nextAttempt,
            });
            this.emitHook(teamId, OrchestrationHookEvents.ExecutionStarted, {
              team_id: teamId,
              task_id: task.id,
              agent_id: agent.id,
              run_id: runId,
              adapter_kind: this.env.kind,
              correlation_task_id: task.id,
            });
            this.notify();
          },
          onStdoutChunk: (chunk) => {
            appendTaskRunStream(task.id, 'stdout', chunk);
            this.scheduleNotify();
          },
          onStderrChunk: (chunk) => {
            appendTaskRunStream(task.id, 'stderr', chunk);
            this.scheduleNotify();
          },
          onComplete: (error, result) => {
            runtime.activeRuns.delete(agent.id);
            this.userCancelledTaskIds.delete(task.id);
            const exitCode = result?.exitCode ?? null;
            const terminal = terminalFromResult(error, result);
            const detail = result?.detail;
            const run_id = result?.runId ?? runId;

            if (executionStarted) {
              if (terminal === 'success') {
                finalizeTaskRun(task.id, {
                  status: 'completed',
                  exit_code: exitCode ?? 0,
                  termination_reason: 'success',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionCompleted, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  exit_code: exitCode ?? 0,
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              } else if (terminal === 'user_cancelled') {
                finalizeTaskRun(task.id, {
                  status: 'cancelled',
                  exit_code: exitCode,
                  error_message: 'user_cancelled',
                  termination_reason: 'user_cancelled',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionCancelled, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  cancellation_reason: 'user_cancelled',
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              } else if (terminal === 'engine_stopped') {
                finalizeTaskRun(task.id, {
                  status: 'cancelled',
                  exit_code: exitCode,
                  error_message: 'engine_stopped',
                  termination_reason: 'engine_stopped',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionCancelled, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  cancellation_reason: 'engine_stopped',
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              } else if (terminal === 'timed_out') {
                finalizeTaskRun(task.id, {
                  status: 'timed_out',
                  exit_code: exitCode,
                  error_message: detail ?? 'timed_out',
                  termination_reason: 'timed_out',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionTimedOut, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  detail: detail ?? null,
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              } else if (terminal === 'policy_rejected') {
                finalizeTaskRun(task.id, {
                  status: 'policy_rejected',
                  exit_code: null,
                  error_message: detail ?? 'policy_rejected',
                  termination_reason: 'policy_rejected',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionPolicyRejected, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  detail: detail ?? null,
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              } else {
                finalizeTaskRun(task.id, {
                  status: 'failed',
                  exit_code: exitCode,
                  error_message: error?.message ?? 'process_error',
                  termination_reason: 'process_error',
                });
                this.emitHook(teamId, OrchestrationHookEvents.ExecutionFailed, {
                  team_id: teamId,
                  task_id: task.id,
                  agent_id: agent.id,
                  run_id,
                  reason: error?.message ?? 'process_error',
                  exit_code: exitCode,
                  adapter_kind: this.env.kind,
                  correlation_task_id: task.id,
                });
              }
            } else if (!executionStarted && terminal === 'policy_rejected') {
              recordPreStartRejectedRun({
                task_id: task.id,
                run_id,
                team_id: teamId,
                agent_id: agent.id,
                environment_kind: this.env.kind,
                error_message: String(detail ?? error?.message ?? 'policy_rejected'),
              });
              this.emitHook(teamId, OrchestrationHookEvents.ExecutionPolicyRejected, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                detail: detail ?? error?.message ?? null,
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
            }

            if (terminal === 'success') {
              updateAgent(agent.id, { status: 'idle', current_task_id: undefined });
              const doneTask = getTaskById(task.id);
              updateTask(task.id, {
                status: 'done',
                payload: stripLegacyRetryFromPayload(doneTask?.payload ?? {}),
                retry_attempt: 0,
                retry_next_at: null,
                retry_last_failure_class: null,
              });
              this.emitHook(teamId, OrchestrationHookEvents.TaskCompleted, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
              recordMetric({
                team_id: teamId,
                agent_id: agent.id,
                key: 'tasks_completed',
                value: 1,
                unit: 'count',
              });
            } else if (terminal === 'user_cancelled' || terminal === 'engine_stopped') {
              updateAgent(agent.id, { status: 'idle', current_task_id: undefined });
              updateTask(task.id, {
                status: 'cancelled',
                assignee_agent_id: undefined,
                retry_attempt: 0,
                retry_next_at: null,
                retry_last_failure_class: null,
              });
              this.emitHook(teamId, OrchestrationHookEvents.TaskCancelled, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                reason: terminal === 'engine_stopped' ? 'engine_stopped' : 'user_cancelled',
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
            } else if (terminal === 'timed_out') {
              if (
                this.tryScheduleRetryAfterFailure({
                  teamId,
                  taskId: task.id,
                  agentId: agent.id,
                  terminal: 'timed_out',
                  runId: run_id,
                  executionStarted,
                })
              ) {
                this.notify();
                return;
              }
              updateAgent(agent.id, { status: 'idle', current_task_id: undefined });
              updateTask(task.id, {
                status: 'timed_out',
                assignee_agent_id: undefined,
                retry_attempt: 0,
                retry_next_at: null,
                retry_last_failure_class: null,
              });
              this.emitHook(teamId, OrchestrationHookEvents.TaskTimedOut, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                detail: detail ?? null,
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
            } else if (terminal === 'policy_rejected') {
              updateAgent(agent.id, { status: 'idle', current_task_id: undefined });
              updateTask(task.id, {
                status: 'failed',
                assignee_agent_id: undefined,
                retry_attempt: 0,
                retry_next_at: null,
                retry_last_failure_class: null,
              });
              this.emitHook(teamId, OrchestrationHookEvents.TaskFailed, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                reason: detail ?? error?.message ?? terminal,
                failure_class: terminal,
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
            } else if (terminal === 'process_error' || (error && terminal !== 'success')) {
              const failTerminal: WorkloadTerminalKind =
                terminal === 'process_error' ? 'process_error' : terminalFromResult(error, result);
              if (
                this.tryScheduleRetryAfterFailure({
                  teamId,
                  taskId: task.id,
                  agentId: agent.id,
                  terminal: failTerminal,
                  runId: run_id,
                  executionStarted,
                })
              ) {
                this.notify();
                return;
              }
              updateAgent(agent.id, { status: 'idle', current_task_id: undefined });
              updateTask(task.id, {
                status: 'failed',
                assignee_agent_id: undefined,
                retry_attempt: 0,
                retry_next_at: null,
                retry_last_failure_class: null,
              });
              this.emitHook(teamId, OrchestrationHookEvents.TaskFailed, {
                team_id: teamId,
                task_id: task.id,
                agent_id: agent.id,
                run_id,
                reason: detail ?? error?.message ?? failTerminal,
                failure_class: failTerminal,
                adapter_kind: this.env.kind,
                correlation_task_id: task.id,
              });
            }
            this.notify();
          },
        }
      );

      runtime.activeRuns.set(agent.id, run);
    }

    runtime.rrIndex = idx;
  }
}
