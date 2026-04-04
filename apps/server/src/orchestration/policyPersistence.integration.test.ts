import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
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
  createExecutionPolicy,
  createTask,
  createTeam,
  getEffectiveLocalProcessPolicyForTeam,
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

describe('Persisted execution policy', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-policy-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    setExecutionEnvironmentKind('local_process');
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

  test('team-linked policy replaces env layer: sh allowed via DB while env allowlist is echo-only', async () => {
    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      cmdAllowlist: ['echo'],
    });
    initLocalProcessConcurrencyFromPolicy();

    const persisted = createExecutionPolicy({
      name: 'allow-sh',
      cmd_allowlist: ['sh', 'echo'],
      cmd_denylist: [],
    });
    const team = createTeam({ name: 'policy-team', execution_policy_id: persisted.id });
    createAgent({ team_id: team.id, name: 'w', role: 'runner' });
    const task = createTask({
      team_id: team.id,
      title: 'via sh',
      status: 'queued',
      payload: { command: ['sh', '-c', 'echo policy-ok'] },
    })!;

    const eff = getEffectiveLocalProcessPolicyForTeam(team.id);
    expect(eff.source).toBe('team_policy');
    expect(eff.policy_id).toBe(persisted.id);
    expect(eff.cmd_allowlist).toContain('sh');

    const engine = new OrchestrationEngine({
      environment: new LocalProcessEnvironment(),
      onStateChange: () => {},
    });
    engine.startTeam(team.id);
    await waitFor(() => getTaskById(task.id)?.status === 'done', 8000);
    engine.stopTeam(team.id);

    expect(getTaskById(task.id)?.status).toBe('done');
  });

  test('no team policy: effective policy reports env_defaults', async () => {
    setLocalProcessPolicyForTests({
      ...loadLocalProcessPolicyFromEnv(),
      cmdAllowlist: ['sh'],
    });
    initLocalProcessConcurrencyFromPolicy();

    const team = createTeam({ name: 'no-pol' });
    const eff = getEffectiveLocalProcessPolicyForTeam(team.id);
    expect(eff.source).toBe('env_defaults');
    expect(eff.policy_id).toBeUndefined();
  });

  test('snapshot lists execution_policies for UI', () => {
    createExecutionPolicy({ name: 'pol-a', cmd_denylist: ['foo'] });
    const snap = getOrchestrationSnapshot();
    expect(snap.execution_policies.length).toBeGreaterThanOrEqual(1);
    expect(snap.execution_policies.some((p) => p.name === 'pol-a')).toBe(true);
  });
});
