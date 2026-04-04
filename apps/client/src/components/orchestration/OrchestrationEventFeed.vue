<template>
  <div class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/70 p-3">
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <h4 class="text-xs font-bold uppercase tracking-wide text-[var(--theme-text-tertiary)] flex-1">
        Orchestration events (hook stream)
      </h4>
      <select
        :value="hookTypeFilter"
        class="rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1 text-[10px] max-w-[200px]"
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
    <p v-if="taskIdFilter" class="text-[10px] text-[var(--theme-text-tertiary)] mb-1">
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
    <ul v-else class="space-y-2 max-h-64 overflow-y-auto text-xs font-mono">
      <li
        v-for="ev in filtered"
        :key="ev.id ?? `${ev.timestamp}-${ev.hook_event_type}`"
        class="rounded border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-secondary)] px-2 py-1"
      >
        <div class="flex justify-between gap-2 text-[10px] text-[var(--theme-text-tertiary)]">
          <span>{{ formatOrchestrationTime(ev.timestamp ?? 0) }}</span>
          <span class="truncate text-[var(--theme-accent-info)]">{{ ev.hook_event_type }}</span>
        </div>
        <div class="text-[var(--theme-text-secondary)] mt-0.5 break-all">
          {{ payloadSummary(ev) }}
        </div>
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
  /** When set, only events whose payload.agent_id matches (orchestration hook payloads). */
  agentIdFilter?: string | null;
  /** When set, only events whose payload correlation_task_id / task_id matches. */
  taskIdFilter?: string | null;
}>();

defineEmits<{ 'update:hookTypeFilter': [v: string]; 'clear-task-filter': [] }>();

const filtered = computed(() => {
  return props.hookEvents
    .filter((e) => e.source_app === ORCH && e.session_id === props.teamId)
    .filter((e) => !props.hookTypeFilter || e.hook_event_type === props.hookTypeFilter)
    .filter((e) => {
      if (!props.agentIdFilter) return true;
      const aid = e.payload && typeof e.payload === 'object' ? (e.payload as { agent_id?: string }).agent_id : undefined;
      return aid === props.agentIdFilter;
    })
    .filter((e) => {
      if (!props.taskIdFilter) return true;
      const p = e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : undefined;
      if (!p) return false;
      const tid = p.correlation_task_id ?? p.task_id;
      return typeof tid === 'string' && tid === props.taskIdFilter;
    })
    .slice(-80)
    .reverse();
});

function payloadSummary(ev: HookEvent): string {
  try {
    return JSON.stringify(ev.payload);
  } catch {
    return String(ev.payload);
  }
}
</script>
