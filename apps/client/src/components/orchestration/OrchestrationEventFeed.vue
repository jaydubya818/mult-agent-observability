<template>
  <div class="rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/70 p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <div class="flex-1">
        <h4 class="text-xs font-bold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">
          Orchestration events
        </h4>
        <p class="mt-1 text-sm text-[var(--theme-text-tertiary)]">
          Focus the live hook stream down to the work that matters right now.
        </p>
      </div>
      <span class="rounded-full border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-1 text-[11px] font-semibold text-[var(--theme-text-secondary)]">
        {{ filtered.length }} visible
      </span>
      <select
        :value="hookTypeFilter"
        class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-2 text-[11px] max-w-[220px]"
        @change="$emit('update:hookTypeFilter', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">All types</option>
        <option value="OrchestrationTaskAssigned">TaskAssigned</option>
        <option value="OrchestrationTaskCompleted">TaskCompleted</option>
        <option value="OrchestrationTaskFailed">TaskFailed</option>
        <option value="OrchestrationExecutionStarted">ExecutionStarted</option>
        <option value="OrchestrationExecutionCompleted">ExecutionCompleted</option>
        <option value="OrchestrationExecutionFailed">ExecutionFailed</option>
        <option value="OrchestrationExecutionCancelled">ExecutionCancelled</option>
        <option value="OrchestrationExecutionTimedOut">ExecutionTimedOut</option>
        <option value="OrchestrationExecutionPolicyRejected">ExecutionPolicyRejected</option>
        <option value="OrchestrationTaskCancelled">TaskCancelled</option>
        <option value="OrchestrationTaskTimedOut">TaskTimedOut</option>
        <option value="OrchestrationTeamStarted">TeamStarted</option>
        <option value="OrchestrationTeamStopped">TeamStopped</option>
      </select>
    </div>

    <p v-if="taskIdFilter" class="mb-2 text-[10px] text-[var(--theme-text-tertiary)]">
      Showing hooks for task
      <span class="font-mono">{{ taskIdFilter.slice(0, 8) }}…</span>
      —
      <button type="button" class="text-[var(--theme-accent-info)] underline" @click="$emit('clear-task-filter')">
        Clear
      </button>
    </p>

    <p v-if="!filtered.length" class="text-xs text-[var(--theme-text-tertiary)]">
      No orchestration events for this team yet. Start a run or watch the timeline.
    </p>
    <ul v-else class="space-y-2 max-h-72 overflow-y-auto text-xs">
      <li
        v-for="ev in filtered"
        :key="ev.id ?? `${ev.timestamp}-${ev.hook_event_type}`"
        class="rounded-2xl border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-secondary)] px-3 py-2"
      >
        <div class="flex items-center justify-between gap-2 text-[10px] text-[var(--theme-text-tertiary)]">
          <span>{{ formatOrchestrationTime(ev.timestamp ?? 0) }}</span>
          <span class="rounded-full bg-[var(--theme-bg-primary)] px-2 py-0.5 font-semibold text-[var(--theme-accent-info)]">
            {{ compactHookType(ev.hook_event_type) }}
          </span>
        </div>
        <div class="mt-2 text-sm leading-relaxed text-[var(--theme-text-secondary)]">
          {{ payloadSummary(ev) }}
        </div>
        <details class="mt-2 text-[10px] text-[var(--theme-text-tertiary)]">
          <summary class="cursor-pointer select-none">Raw payload</summary>
          <pre class="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[var(--theme-bg-primary)]/70 p-2 font-mono text-[10px] text-[var(--theme-text-secondary)]">{{ safeJson(ev.payload) }}</pre>
        </details>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HookEvent } from '../../types';
import { formatOrchestrationTime } from '../../utils/orchestrationFormat';

const ORCH = 'orchestration';

const props = defineProps<{
  hookEvents: HookEvent[];
  teamId: string;
  hookTypeFilter: string;
  agentIdFilter?: string | null;
  taskIdFilter?: string | null;
}>();

defineEmits<{ 'update:hookTypeFilter': [v: string]; 'clear-task-filter': [] }>();

const filtered = computed(() => {
  return props.hookEvents
    .filter((event) => event.source_app === ORCH && event.session_id === props.teamId)
    .filter((event) => !props.hookTypeFilter || event.hook_event_type === props.hookTypeFilter)
    .filter((event) => {
      if (!props.agentIdFilter) return true;
      const agentId =
        event.payload && typeof event.payload === 'object'
          ? (event.payload as { agent_id?: string }).agent_id
          : undefined;
      return agentId === props.agentIdFilter;
    })
    .filter((event) => {
      if (!props.taskIdFilter) return true;
      const payload =
        event.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : undefined;
      if (!payload) return false;
      const taskId = payload.correlation_task_id ?? payload.task_id;
      return typeof taskId === 'string' && taskId === props.taskIdFilter;
    })
    .slice(-80)
    .reverse();
});

function payloadSummary(event: HookEvent): string {
  if (event.summary?.trim()) return event.summary;

  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : {};

  const taskId = typeof payload.task_id === 'string' ? payload.task_id : null;
  const correlationTaskId =
    typeof payload.correlation_task_id === 'string' ? payload.correlation_task_id : null;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : null;
  const reason = typeof payload.reason === 'string' ? payload.reason : null;

  switch (event.hook_event_type) {
    case 'OrchestrationTaskAssigned':
      return `Assigned task ${shortId(taskId)} to agent ${shortId(agentId)}.`;
    case 'OrchestrationTaskCompleted':
      return `Task ${shortId(taskId)} completed successfully.`;
    case 'OrchestrationTaskFailed':
      return `Task ${shortId(taskId)} failed${reason ? `: ${reason}` : '.'}`;
    case 'OrchestrationExecutionStarted':
      return `Execution started for task ${shortId(correlationTaskId ?? taskId)}.`;
    case 'OrchestrationExecutionCompleted':
      return `Execution completed for task ${shortId(correlationTaskId ?? taskId)}.`;
    case 'OrchestrationExecutionFailed':
      return `Execution failed for task ${shortId(correlationTaskId ?? taskId)}${reason ? `: ${reason}` : '.'}`;
    case 'OrchestrationExecutionPolicyRejected':
      return `Execution was blocked by policy for task ${shortId(correlationTaskId ?? taskId)}.`;
    case 'OrchestrationExecutionTimedOut':
      return `Execution timed out for task ${shortId(correlationTaskId ?? taskId)}.`;
    case 'OrchestrationTaskCancelled':
      return `Task ${shortId(taskId)} was cancelled${reason ? `: ${reason}` : '.'}`;
    case 'OrchestrationTaskTimedOut':
      return `Task ${shortId(taskId)} timed out.`;
    case 'OrchestrationTeamStarted':
      return 'Team execution started.';
    case 'OrchestrationTeamStopped':
      return `Team execution stopped${reason ? `: ${reason}` : '.'}`;
    default:
      return safeJson(event.payload);
  }
}

function shortId(value: string | null): string {
  if (!value) return 'unknown';
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

function compactHookType(hookEventType: string): string {
  return hookEventType.replace(/^Orchestration/, '');
}

function safeJson(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
</script>
