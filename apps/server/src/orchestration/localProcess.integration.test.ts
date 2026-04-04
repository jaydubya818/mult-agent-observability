import { mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import type { HookEvent } from '../types';
import { OrchestrationEngine } from './engine';
import { LocalProcessEnvironment } from './environments/localProcessEnvironment';
import {
  initLocalProcessConcurrencyFromPolicy,
  loadLocalProcessPolicyFromEnv,
  resetLocalProcessTestState,
  setLocalProcessPolicyForTests,
} from './environments/localProcessPolicy';
import {
  createAgent,
  createTask,
  createTeam,
  getOrchestrationSnapshot,
  getTaskById,
  initOrchestrationSchema,
} from './repository';
import { setExecutionEnvironmentKind } from './runtimeMeta';

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timeout waiting for condition');
}

describe('LocalProcessEnvironment integration', () => {
  const savedEvents: HookEvent[] = [];
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-test-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    setExecutionEnvironmentKind('local_process');
    savedEvents.length = 0;
    resetLocalProcessTestState();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 400));
    setLocalProcessPolicyForTests(null);
    resetLocalProcessTestState();
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('successful subprocess: task done, stdout captured, execution events', async () => {
    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'proc-team' });
    expect(team).toBeTruthy();
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'echo ok',
      status: 'queued',
      payload: { command: ['sh', '-c', 'echo hello-exec'] },
    });
    expect(task).toBeTruthy();

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'done', 8000);
    engine.stopTeam(team!.id);

    expect(getTaskById(task!.id)?.status).toBe('done');

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(run?.status).toBe('completed');
    expect(run?.exit_code).toBe(0);
    expect(run?.stdout_tail).toContain('hello-exec');

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types).toContain('OrchestrationExecutionStarted');
    expect(types).toContain('OrchestrationExecutionCompleted');
    expect(types).toContain('OrchestrationTaskCompleted');
  });

  test('failing subprocess: non-zero exit maps to failed task and run record', async () => {
    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'fail-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'exit 7',
      status: 'queued',
      payload: { command: ['sh', '-c', 'exit 7'] },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'failed', 8000);
    engine.stopTeam(team!.id);

    expect(getTaskById(task!.id)?.status).toBe('failed');

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(run?.status).toBe('failed');
    expect(run?.exit_code).toBe(7);

    const types = savedEvents.map((e) => e.hook_event_type);
    expect(types).toContain('OrchestrationExecutionFailed');
    expect(types).toContain('OrchestrationTaskFailed');
  });

  test('user cancellation: task cancelled, run cancelled, user_cancelled termination', async () => {
    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'cancel-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'sleep',
      status: 'queued',
      payload: { command: ['sleep', '60'] },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'running', 8000);

    const ok = engine.cancelTask(task!.id);
    expect(ok).toBe(true);

    await waitFor(() => getTaskById(task!.id)?.status === 'cancelled', 8000);
    engine.stopTeam(team!.id);

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(run?.status).toBe('cancelled');
    expect(run?.termination_reason).toBe('user_cancelled');

    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationExecutionCancelled')).toBe(true);
    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationTaskCancelled')).toBe(true);
  });

  test('engine stop: running task ends cancelled with engine_stopped on run', async () => {
    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'stop-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'sleep',
      status: 'queued',
      payload: { command: ['sleep', '60'] },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'running', 8000);
    engine.stopTeam(team!.id);

    await waitFor(() => getTaskById(task!.id)?.status === 'cancelled', 8000);
    await waitFor(() => {
      const r = getOrchestrationSnapshot().task_runs.find((x) => x.task_id === task!.id);
      return r != null && r.status !== 'running';
    }, 8000);

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(run?.status).toBe('cancelled');
    expect(run?.termination_reason).toBe('engine_stopped');

    const cancelledPayloads = savedEvents
      .filter((e) => e.hook_event_type === 'OrchestrationExecutionCancelled')
      .map((e) => e.payload as { cancellation_reason?: string });
    expect(cancelledPayloads.some((p) => p.cancellation_reason === 'engine_stopped')).toBe(true);
  });

  test('policy allowlist blocks command before spawn: failed task, policy hook, rejected run stub', async () => {
    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      cmdAllowlist: ['echo'],
    });
    initLocalProcessConcurrencyFromPolicy();

    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'deny-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'not on allowlist',
      status: 'queued',
      payload: { command: ['sh', '-c', 'echo hi'] },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'failed', 8000);
    engine.stopTeam(team!.id);

    const snap = getOrchestrationSnapshot();
    const stub = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(stub?.status).toBe('policy_rejected');
    expect(stub?.termination_reason).toBe('policy_rejected');
    expect(stub?.finished_at).not.toBeNull();
    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationExecutionPolicyRejected')).toBe(true);
    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationTaskFailed')).toBe(true);
  });

  test('cwd outside allowlist fails before spawn', async () => {
    const allowed = path.join(tmpdir(), `orch-ok-${crypto.randomUUID()}`);
    const outside = path.join(tmpdir(), `orch-bad-${crypto.randomUUID()}`);
    mkdirSync(allowed);
    mkdirSync(outside);

    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      cwdAllowlistRoots: [path.resolve(allowed)],
    });
    initLocalProcessConcurrencyFromPolicy();

    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'cwd-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'wrong cwd',
      status: 'queued',
      payload: {
        command: ['sh', '-c', 'echo hi'],
        cwd: outside,
      },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'failed', 8000);
    engine.stopTeam(team!.id);

    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationExecutionPolicyRejected')).toBe(true);
  });

  test('per-task timeout maps to timed_out task and run', async () => {
    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      maxRuntimeMs: 600,
    });
    initLocalProcessConcurrencyFromPolicy();

    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'to-team' });
    createAgent({ team_id: team!.id, name: 'worker', role: 'runner' });
    const task = createTask({
      team_id: team!.id,
      title: 'slow',
      status: 'queued',
      payload: { command: ['sleep', '30'] },
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(task!.id)?.status === 'timed_out', 12_000);
    engine.stopTeam(team!.id);

    const snap = getOrchestrationSnapshot();
    const run = snap.task_runs.find((r) => r.task_id === task!.id);
    expect(run?.status).toBe('timed_out');
    expect(run?.termination_reason).toBe('timed_out');
    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationExecutionTimedOut')).toBe(true);
    expect(savedEvents.some((e) => e.hook_event_type === 'OrchestrationTaskTimedOut')).toBe(true);
  });

  test(
    'max concurrent local_process: second task fails when slot exhausted',
    async () => {
    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      maxConcurrent: 1,
    });
    initLocalProcessConcurrencyFromPolicy();

    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
      onHookEvent: (e) => savedEvents.push(e),
    });

    const team = createTeam({ name: 'conc-team' });
    createAgent({ team_id: team!.id, name: 'a1', role: 'runner' });
    createAgent({ team_id: team!.id, name: 'a2', role: 'runner' });
    const t1 = createTask({
      team_id: team!.id,
      title: 'hold',
      status: 'queued',
      payload: { command: ['sleep', '8'] },
      priority: 3,
    });
    const t2 = createTask({
      team_id: team!.id,
      title: 'fast',
      status: 'queued',
      payload: { command: ['sh', '-c', 'echo second'] },
      priority: 2,
    });

    engine.startTeam(team!.id);
    await waitFor(() => getTaskById(t2!.id)?.status === 'failed', 12_000);
    expect(getTaskById(t1!.id)?.status).toBe('running');
    engine.stopTeam(team!.id);

    expect(getTaskById(t2!.id)?.status).toBe('failed');
    expect(
      savedEvents.some(
        (e) =>
          e.hook_event_type === 'OrchestrationExecutionPolicyRejected' &&
          String((e.payload as { detail?: string }).detail ?? '').toLowerCase().includes('concurrent')
      )
    ).toBe(true);
    },
    { timeout: 15_000 }
  );
});
