import { describe, expect, test } from 'bun:test';
import type { OrchestrationSnapshot } from '../orchestrationTypes';
import type { HookEvent } from '../types';
import {
  buildObservabilitySummary,
  buildOrchestrationSummary,
} from './commandCenterSummary';

describe('commandCenterSummary', () => {
  test('buildObservabilitySummary derives top-level telemetry metrics', () => {
    const events: HookEvent[] = [
      {
        source_app: 'alpha',
        session_id: 'session-a',
        hook_event_type: 'PreToolUse',
        payload: { tool_name: 'Write' },
        timestamp: 10,
      },
      {
        source_app: 'alpha',
        session_id: 'session-a',
        hook_event_type: 'PermissionRequest',
        payload: {},
        timestamp: 20,
      },
      {
        source_app: 'beta',
        session_id: 'session-b',
        hook_event_type: 'PostToolUse',
        payload: { tool_name: 'Read' },
        timestamp: 30,
      },
    ];

    expect(buildObservabilitySummary(events)).toEqual({
      trackedAgents: 2,
      activeSessions: 2,
      toolCalls: 2,
      approvalRequests: 1,
      latestEventAt: 30,
      dominantHookType: 'PreToolUse',
    });
  });

  test('buildOrchestrationSummary derives operator-facing queue state', () => {
    const snapshot = {
      teams: [
        { id: 't1', execution_status: 'running' },
        { id: 't2', execution_status: 'stopped' },
      ],
      agents: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      tasks: [
        { id: 'q1', status: 'queued' },
        { id: 'q2', status: 'queued' },
        { id: 'r1', status: 'running' },
        { id: 'f1', status: 'failed' },
        { id: 'b1', status: 'blocked' },
      ],
      sandboxes: [
        { id: 's1', status: 'running' },
        { id: 's2', status: 'stopped' },
      ],
    } as unknown as OrchestrationSnapshot;

    expect(buildOrchestrationSummary(snapshot)).toEqual({
      totalTeams: 2,
      runningTeams: 1,
      trackedAgents: 3,
      queuedTasks: 2,
      activeTasks: 1,
      attentionTasks: 2,
      runningSandboxes: 1,
    });
  });
});
