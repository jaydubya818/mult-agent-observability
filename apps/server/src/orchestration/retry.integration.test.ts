import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import type { HookEvent } from '../types';
import { OrchestrationEngine } from './engine';
import type {
  ExecutionEnvironment,
  RunWorkloadHooks,
  RunWorkloadParams,
  WorkloadTerminalKind,
} from './environments/executionEnvironment';
import { SimulatedEnvironment } from './environments/simulatedEnvironment';
import {
  createAgent,
  createExecutionPolicy,
  createTask,
  createTeam,
  getOrchestrationSnapshot,
  getTaskById,
  initOrchestrationSchema,
  updateTask,
} from './repository';
import { ORCH_RETRY_PAYLOAD_KEY } from './retryPolicy';
import { setExecutionEnvironmentKind } from './runtimeMeta';
import { OrchestrationHookEvents } from './types';

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timeout waiting for condition');
}

/** Sequential outcomes per workload invocation (each in-flight task gets next outcome). */
class ScriptedWorkloadEnvironment implements ExecutionEnvironment {
  readonly kind = 'scripted_retry_test';
  private idx = 0;
  constructor(private readonly outcomes: WorkloadTerminalKind[]) {}

  runWorkload(params: RunWorkloadParams, hooks: RunWorkloadHooks): { cancel: () => void } {
    const outcome = this.outcomes[this.idx] ?? 'success';
    this.idx += 1;

    if (outcome === 'policy_rejected') {
      queueMicrotask(() =>
        hooks.onComplete(undefined, {
          terminalKind: 'policy_rejected',
          detail: 'blocked',
          runId: params.runId,
        })
      );
      return { cancel: () => {} };
    }

    hooks.onBegin();
    queueMicrotask(() => {
      if (outcome === 'success') {
        hooks.onComplete(undefined, { terminalKind: 'success', exitCode: 0, runId: params.runId });
      } else if (outcome === 'process_error') {
        hooks.onComplete(new Error('boom'), { terminalKind: 'process_error', runId: params.runId });
      } else if (outcome === 'timed_out') {
        hooks.onComplete(undefined, { terminalKind: 'timed_out', detail: 'timeout', runId: params.runId });
      } else if (outcome === 'user_cancelled') {
        hooks.onComplete(undefined, { terminalKind: 'user_cancelled', runId: params.runId });
      } else if (outcome === 'engine_stopped') {
        hooks.onComplete(undefined, { terminalKind: 'engine_stopped', runId: params.runId });
      }
    });

    return { cancel: () => {} };
  }
}

describe('Task execution retries', () => {
  const savedEnv = { max: process.env.ORCH_TASK_MAX_ATTEMPTS, backoff: process.env.ORCH_TASK_RETRY_BACKOFF_MS };
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-retry-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    setExecutionEnvironmentKind('scripted_retry_test');
  });

  afterEach(() => {
    if (savedEnv.max != null) process.env.ORCH_TASK_MAX_ATTEMPTS = savedEnv.max;
    else delete process.env.ORCH_TASK_MAX_ATTEMPTS;
    if (savedEnv.backoff != null) process.env.ORCH_TASK_RETRY_BACKOFF_MS = savedEnv.backoff;
    else delete process.env.ORCH_TASK_RETRY_BACKOFF_MS;
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('retries on process_error when max_attempts > 1, then succeeds', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '3';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'process_error', 'success']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r1' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'done', 5000);
    engine.stopTeam(team.id);

    const t = getTaskById(task.id)!;
    expect(t.payload[ORCH_RETRY_PAYLOAD_KEY]).toBeUndefined();
    expect(t.retry?.attempt).toBe(0);
    expect(t.retry?.effective.max_attempts).toBe(3);
    expect(t.retry_next_at).toBeNull();

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types.filter((x) => x === OrchestrationHookEvents.TaskRetryScheduled).length).toBe(2);
    expect(types).toContain(OrchestrationHookEvents.TaskCompleted);

    const scheduled = savedEvents.filter((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled);
    expect(scheduled.every((e) => (e.payload as { retry_config?: { max_attempts: number } }).retry_config?.max_attempts === 3)).toBe(
      true
    );

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task.id);
    expect(run?.status).toBe('completed');
    expect(run?.attempt).toBe(3);
  });

  test('no retry on policy_rejected (pre-start)', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '3';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['policy_rejected']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r2' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'failed', 3000);
    engine.stopTeam(team.id);

    expect(savedEvents.some((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled)).toBe(false);
    expect(getTaskById(task.id)?.status).toBe('failed');
  });

  test('no retry on user cancellation', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '3';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new SimulatedEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r3' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'running', 3000);
    engine.cancelTask(task.id);
    await waitFor(() => getTaskById(task.id)?.status === 'cancelled', 3000);
    engine.stopTeam(team.id);

    expect(savedEvents.some((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled)).toBe(false);
    expect(getTaskById(task.id)?.status).toBe('cancelled');
  });

  test('retry exhausted emits TaskRetryExhausted and leaves task failed', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '2';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'process_error', 'process_error']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r4' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'failed', 5000);
    engine.stopTeam(team.id);

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types).toContain(OrchestrationHookEvents.TaskRetryExhausted);
    expect(types.filter((x) => x === OrchestrationHookEvents.TaskRetryScheduled).length).toBe(1);

    const exhausted = savedEvents.find((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryExhausted)!;
    expect(exhausted.payload.attempt).toBe(2);
    expect((exhausted.payload as { retry_config?: { max_attempts: number } }).retry_config?.max_attempts).toBe(2);

    const final = getTaskById(task.id)!;
    expect(final.status).toBe('failed');
    expect(final.retry_attempt).toBe(0);
    expect(final.retry_next_at).toBeNull();
    expect(final.payload[ORCH_RETRY_PAYLOAD_KEY]).toBeUndefined();
  });

  test('team-backed retry_max_attempts overrides env defaults', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '5';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'process_error', 'process_error']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'team-cap', retry_max_attempts: 2, retry_backoff_ms: 0 })!;
    expect(team.resolved_retry.max_attempts).toBe(2);
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'failed', 5000);
    engine.stopTeam(team.id);

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types.filter((x) => x === OrchestrationHookEvents.TaskRetryScheduled).length).toBe(1);
    expect(types).toContain(OrchestrationHookEvents.TaskRetryExhausted);

    const scheduled = savedEvents.find((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled)!;
    expect((scheduled.payload as { retry_config?: { max_attempts: number } }).retry_config?.max_attempts).toBe(2);
  });

  test('execution policy retry layer applies when team columns are null', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '5';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '0';

    const pol = createExecutionPolicy({ name: 'retry-pol', retry_max_attempts: 2, retry_backoff_ms: 0 });
    const team = createTeam({ name: 'policy-team', execution_policy_id: pol.id })!;
    expect(team.resolved_retry.max_attempts).toBe(2);

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'process_error', 'process_error']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'failed', 5000);
    engine.stopTeam(team.id);

    expect(savedEvents.some((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryExhausted)).toBe(true);
    expect(savedEvents.filter((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled).length).toBe(1);
  });

  test('ordinary payload updates do not clear persisted retry columns', async () => {
    const team = createTeam({ name: 'payload-team' })!;
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: { a: 1 } })!;
    const future = 9_999_999_999_000;
    updateTask(task.id, {
      retry_attempt: 2,
      retry_next_at: future,
      retry_last_failure_class: 'process_error',
    });
    updateTask(task.id, { payload: { b: 'x' } });

    const t = getTaskById(task.id)!;
    expect(t.retry_attempt).toBe(2);
    expect(t.retry_next_at).toBe(future);
    expect(t.retry_last_failure_class).toBe('process_error');
    expect(t.payload.a).toBe(1);
    expect(t.payload.b).toBe('x');
    expect(t.payload[ORCH_RETRY_PAYLOAD_KEY]).toBeUndefined();
  });

  test('exponential backoff delays second attempt when backoff_ms > 0', async () => {
    process.env.ORCH_TASK_MAX_ATTEMPTS = '3';
    process.env.ORCH_TASK_RETRY_BACKOFF_MS = '120';

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'success']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r5' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => savedEvents.some((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled), 3000);

    const tRetry = savedEvents.find((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled)!;
    const nextAt = tRetry.payload.next_retry_at as number;
    expect(nextAt).toBeGreaterThan(Date.now() - 200);

    await waitFor(() => getTaskById(task.id)?.status === 'done', 8000);
    engine.stopTeam(team.id);

    const starts = savedEvents.filter((e) => e.hook_event_type === OrchestrationHookEvents.ExecutionStarted);
    expect(starts.length).toBe(2);
    const delta = (starts[1]!.timestamp as number) - (starts[0]!.timestamp as number);
    expect(delta).toBeGreaterThanOrEqual(90);
  });

  test('default max_attempts=1 does not retry (compatible with prior behavior)', async () => {
    delete process.env.ORCH_TASK_MAX_ATTEMPTS;
    delete process.env.ORCH_TASK_RETRY_BACKOFF_MS;

    const savedEvents: HookEvent[] = [];
    const engine = new OrchestrationEngine({
      environment: new ScriptedWorkloadEnvironment(['process_error', 'success']),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'r6' })!;
    createAgent({ team_id: team.id, name: 'a', role: 'r' });
    const task = createTask({ team_id: team.id, title: 't', status: 'queued', payload: {} })!;

    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'failed', 3000);
    engine.stopTeam(team.id);

    expect(savedEvents.some((e) => e.hook_event_type === OrchestrationHookEvents.TaskRetryScheduled)).toBe(false);
    expect(getTaskById(task.id)?.status).toBe('failed');
  });
});
