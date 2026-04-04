import type { AgentStatus, TaskStatus } from '../orchestrationTypes';

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatOrchestrationTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function agentStatusPillClass(status: string): string {
  if (status === 'running') return 'bg-emerald-500/15 text-emerald-600';
  if (status === 'idle') return 'bg-slate-500/10 text-slate-500';
  if (status === 'error') return 'bg-red-500/15 text-red-600';
  return 'bg-amber-500/15 text-amber-700';
}

export function messageDirectionColor(dir: string): string {
  if (dir === 'orchestrator_to_agent') return 'var(--theme-accent-info)';
  if (dir === 'agent_to_orchestrator') return 'var(--theme-accent-success)';
  return 'var(--theme-text-tertiary)';
}

export function executionLabel(
  executionStatus: 'stopped' | 'running'
): string {
  return executionStatus === 'running' ? '● Running' : '○ Stopped';
}

export const TASK_STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'queued',
  'running',
  'blocked',
  'done',
  'failed',
  'cancelled',
  'timed_out',
];

export const AGENT_STATUS_FILTER_OPTIONS: { value: '' | AgentStatus; label: string }[] = [
  { value: '', label: 'All agents' },
  { value: 'idle', label: 'Idle' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
  { value: 'completed', label: 'Completed' },
];
