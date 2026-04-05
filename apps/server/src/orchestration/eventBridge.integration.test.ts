/**
 * eventBridge.integration.test.ts
 *
 * Regression tests for the event bridge — the layer that translates Claude
 * Code PostToolUse hook events into orchestration DB state.
 *
 * Key regression being locked: team_create with a tool-supplied team_id MUST
 * preserve that exact id so downstream task_create / send_message events that
 * reference the same team_id succeed via FK, not generate a mismatched UUID.
 */

import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import type { HookEvent } from '../types';
import {
  getOrchestrationSnapshot,
  initOrchestrationSchema,
} from './repository';
import { processHookEventForOrchestration } from './eventBridge';

// ─── helpers ────────────────────────────────────────────────────────────────

let dbPath: string;

function makeEvent(overrides: Partial<HookEvent> & { payload: HookEvent['payload'] }): HookEvent {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    source_app: 'claude_code',
    session_id: 'test-session-001',
    hook_event_type: 'PostToolUse',
    model_name: 'claude-opus-4-6',
    timestamp: Date.now(),
    ...overrides,
  } as HookEvent;
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  dbPath = path.join(tmpdir(), `test-event-bridge-${Date.now()}.sqlite`);
  initDatabase(dbPath);
  initOrchestrationSchema();
});

afterEach(() => {
  closeDatabase();
  try { unlinkSync(dbPath); } catch {}
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('eventBridge – team_create', () => {
  test('preserves tool-supplied team_id in the DB', () => {
    const TEAM_ID = 'explicit-team-abc123';

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Explicit ID Team', description: 'Should keep this id' },
        tool_response: { team_id: TEAM_ID, name: 'Explicit ID Team' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const team = snap.teams.find(t => t.id === TEAM_ID);
    expect(team).toBeDefined();
    expect(team?.name).toBe('Explicit ID Team');
  });

  test('replayed team_create refreshes name and description (true upsert)', () => {
    const TEAM_ID = 'upsert-team-001';

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Original Name', description: 'v1' },
        tool_response: { team_id: TEAM_ID, name: 'Original Name' },
      },
    }));

    // Replay with updated metadata (same team_id)
    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Updated Name', description: 'v2' },
        tool_response: { team_id: TEAM_ID, name: 'Updated Name' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const team = snap.teams.find(t => t.id === TEAM_ID);
    expect(team?.name).toBe('Updated Name');
    expect(team?.description).toBe('v2');
  });

  test('generates a UUID when no team_id in tool response', () => {
    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Auto ID Team', description: 'no explicit id' },
        tool_response: {},
      },
    }));

    const snap = getOrchestrationSnapshot();
    expect(snap.teams).toHaveLength(1);
    // id should be a v4 UUID, not empty
    expect(snap.teams[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('registers the calling session as orchestrator agent', () => {
    const TEAM_ID = 'agent-reg-team';

    processHookEventForOrchestration(makeEvent({
      session_id: 'orch-session-xyz',
      model_name: 'claude-opus-4-6',
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Agent Reg Team', description: '' },
        tool_response: { team_id: TEAM_ID, name: 'Agent Reg Team' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const agents = snap.agents.filter(a => a.team_id === TEAM_ID);
    expect(agents).toHaveLength(1);
    expect(agents[0].role).toBe('orchestrator');
    expect(agents[0].model_name).toBe('claude-opus-4-6');
  });
});

describe('eventBridge – team_create → task_create FK chain (regression)', () => {
  test('task inserted with same team_id links to team without FK failure', () => {
    const TEAM_ID = 'fk-regression-team';
    const TASK_ID = 'fk-regression-task';

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'FK Test Team', description: 'FK regression' },
        tool_response: { team_id: TEAM_ID, name: 'FK Test Team' },
      },
    }));

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'task_create',
        tool_input: { team_id: TEAM_ID, title: 'Regression Task', description: 'should link', priority: 1 },
        tool_response: { task_id: TASK_ID, team_id: TEAM_ID },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const task = snap.tasks.find(t => t.id === TASK_ID);
    expect(task).toBeDefined();
    expect(task?.team_id).toBe(TEAM_ID);
  });

  test('send_message after team_create captures message body and team reference', () => {
    const TEAM_ID = 'msg-test-team';

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Msg Test Team', description: '' },
        tool_response: { team_id: TEAM_ID, name: 'Msg Test Team' },
      },
    }));

    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'send_message',
        tool_input: { team_id: TEAM_ID, message: 'All systems nominal', kind: 'report' },
        tool_response: { status: 'sent' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const msgs = snap.messages.filter(m => m.team_id === TEAM_ID);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('All systems nominal');
    expect(msgs[0].kind).toBe('report');
  });

  test('full chain: team_create → task_create × 2 → send_message → snapshot coherent', () => {
    const TEAM_ID = 'full-chain-team';

    const events = [
      { tool_name: 'team_create', tool_input: { name: 'Full Chain', description: 'e2e' }, tool_response: { team_id: TEAM_ID, name: 'Full Chain' } },
      { tool_name: 'task_create', tool_input: { team_id: TEAM_ID, title: 'Task Alpha', priority: 1 }, tool_response: { task_id: 'chain-task-001', team_id: TEAM_ID } },
      { tool_name: 'task_create', tool_input: { team_id: TEAM_ID, title: 'Task Beta', priority: 2 }, tool_response: { task_id: 'chain-task-002', team_id: TEAM_ID } },
      { tool_name: 'send_message', tool_input: { team_id: TEAM_ID, message: 'Starting work', kind: 'directive' }, tool_response: { status: 'sent' } },
    ];

    for (const payload of events) {
      processHookEventForOrchestration(makeEvent({ payload }));
    }

    const snap = getOrchestrationSnapshot();
    expect(snap.teams.find(t => t.id === TEAM_ID)).toBeDefined();
    expect(snap.tasks.filter(t => t.team_id === TEAM_ID)).toHaveLength(2);
    expect(snap.messages.filter(m => m.team_id === TEAM_ID)).toHaveLength(1);
    expect(snap.agents.filter(a => a.team_id === TEAM_ID)).toHaveLength(1);
  });
});

describe('eventBridge – non-PostToolUse events do not mutate state', () => {
  test('PreToolUse event returns false (no mutation)', () => {
    const mutated = processHookEventForOrchestration(makeEvent({
      hook_event_type: 'PreToolUse',
      payload: {
        tool_name: 'team_create',
        tool_input: { name: 'Should Not Create', description: '' },
        tool_response: { team_id: 'should-not-exist' },
      },
    }));

    expect(mutated).toBe(false);
    const snap = getOrchestrationSnapshot();
    expect(snap.teams.find(t => t.id === 'should-not-exist')).toBeUndefined();
  });
});

describe('eventBridge – sandbox tools', () => {
  test('sandbox_create upserts a running sandbox record', () => {
    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'sandbox_create',
        tool_input: { template: 'node-18' },
        tool_response: { sandbox_id: 'sbx-001', url: 'https://sbx-001.e2b.dev' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const sandbox = (snap as any).sandboxes?.find((s: any) => s.id === 'sbx-001');
    expect(sandbox).toBeDefined();
    expect(sandbox?.status).toBe('running');
    expect(sandbox?.url).toBe('https://sbx-001.e2b.dev');
  });

  test('sandbox_kill marks sandbox stopped', () => {
    // Create first
    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'sandbox_create',
        tool_input: {},
        tool_response: { sandbox_id: 'sbx-kill-001' },
      },
    }));

    // Then kill
    processHookEventForOrchestration(makeEvent({
      payload: {
        tool_name: 'sandbox_kill',
        tool_input: { sandbox_id: 'sbx-kill-001' },
        tool_response: { status: 'killed' },
      },
    }));

    const snap = getOrchestrationSnapshot();
    const sandbox = (snap as any).sandboxes?.find((s: any) => s.id === 'sbx-kill-001');
    expect(sandbox?.status).toBe('stopped');
  });
});
