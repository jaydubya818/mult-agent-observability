import type { OrchestrationSnapshot } from '../orchestrationTypes';
import type { HookEvent } from '../types';

export interface ObservabilitySummary {
  trackedAgents: number;
  activeSessions: number;
  toolCalls: number;
  approvalRequests: number;
  latestEventAt: number | null;
  dominantHookType: string | null;
}

export interface OrchestrationSummary {
  totalTeams: number;
  runningTeams: number;
  trackedAgents: number;
  queuedTasks: number;
  activeTasks: number;
  attentionTasks: number;
  runningSandboxes: number;
}

export function buildObservabilitySummary(events: HookEvent[]): ObservabilitySummary {
  const trackedAgents = new Set<string>();
  const activeSessions = new Set<string>();
  const hookCounts = new Map<string, number>();
  let toolCalls = 0;
  let approvalRequests = 0;
  let latestEventAt: number | null = null;

  for (const event of events) {
    if (event.source_app) trackedAgents.add(event.source_app);
    if (event.session_id) activeSessions.add(event.session_id);

    if (event.hook_event_type) {
      hookCounts.set(event.hook_event_type, (hookCounts.get(event.hook_event_type) ?? 0) + 1);
    }

    if (
      event.hook_event_type === 'PreToolUse' ||
      event.hook_event_type === 'PostToolUse' ||
      event.hook_event_type === 'PostToolUseFailure'
    ) {
      toolCalls += 1;
    }

    if (
      event.hook_event_type === 'PermissionRequest' ||
      event.humanInTheLoop?.type === 'permission'
    ) {
      approvalRequests += 1;
    }

    if (typeof event.timestamp === 'number') {
      latestEventAt = latestEventAt == null ? event.timestamp : Math.max(latestEventAt, event.timestamp);
    }
  }

  const dominantHookType =
    [...hookCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    trackedAgents: trackedAgents.size,
    activeSessions: activeSessions.size,
    toolCalls,
    approvalRequests,
    latestEventAt,
    dominantHookType,
  };
}

export function buildOrchestrationSummary(
  snapshot: OrchestrationSnapshot | null
): OrchestrationSummary {
  if (!snapshot) {
    return {
      totalTeams: 0,
      runningTeams: 0,
      trackedAgents: 0,
      queuedTasks: 0,
      activeTasks: 0,
      attentionTasks: 0,
      runningSandboxes: 0,
    };
  }

  const queuedTasks = snapshot.tasks.filter((task) => task.status === 'queued').length;
  const activeTasks = snapshot.tasks.filter((task) => task.status === 'running').length;
  const attentionTasks = snapshot.tasks.filter((task) =>
    task.status === 'failed' || task.status === 'blocked' || task.status === 'timed_out'
  ).length;

  return {
    totalTeams: snapshot.teams.length,
    runningTeams: snapshot.teams.filter((team) => team.execution_status === 'running').length,
    trackedAgents: snapshot.agents.length,
    queuedTasks,
    activeTasks,
    attentionTasks,
    runningSandboxes: (snapshot.sandboxes ?? []).filter((sandbox) => sandbox.status === 'running').length,
  };
}
