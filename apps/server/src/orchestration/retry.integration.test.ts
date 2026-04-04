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
  createTask,
  createTeam,
  getOrchestrationSnapshot,
  getTaskById,
  initOrchestrationSchema,
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
    expect(t.retry).toBeUndefined();

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types.filter((x) => x === OrchestrationHookEvents.TaskRetryScheduled).length).toBe(2);
    expect(types).toContain(OrchestrationHookEvents.TaskCompleted);

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

    const meta = getTaskById(task.id)?.payload[ORCH_RETRY_PAYLOAD_KEY] as { attempt?: number } | undefined;
    expect(meta?.attempt).toBe(2);
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
