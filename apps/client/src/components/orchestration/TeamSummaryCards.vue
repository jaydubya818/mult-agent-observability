<template>
  <div v-if="summary" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
    <div
      v-for="card in cards"
      :key="card.key"
      class="rounded-2xl border px-4 py-3 shadow-sm"
      :class="card.className"
    >
      <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">{{ card.label }}</div>
      <div class="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-[var(--theme-text-primary)]">{{ card.value }}</div>
      <div class="mt-1 text-[11px] text-[var(--theme-text-tertiary)]">{{ card.help }}</div>
    </div>
  </div>
  <p v-else class="text-xs text-[var(--theme-text-tertiary)]">Select a team to see live counts.</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TeamSummary } from '../../orchestrationTypes';

const props = defineProps<{
  summary: TeamSummary | null;
}>();

const cards = computed(() => {
  const s = props.summary;
  if (!s) return [];
  const tc = s.task_counts;
  const attention = tc.failed + tc.timed_out + tc.blocked;
  return [
    {
      key: 'agents',
      label: 'Agents',
      value: s.agent_count,
      help: 'Registered on this team',
      className: 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]',
    },
    {
      key: 'retry_max',
      label: 'Retry cap',
      value: s.resolved_retry.max_attempts,
      help: `Backoff ${s.resolved_retry.backoff_ms}ms`,
      className: 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]',
    },
    {
      key: 'queued',
      label: 'Queued',
      value: tc.queued,
      help: tc.backlog > 0 ? `${tc.backlog} backlog` : 'Ready to claim',
      className: 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]',
    },
    {
      key: 'running',
      label: 'Running',
      value: tc.running,
      help: 'Active execution now',
      className: 'border-emerald-500/25 bg-emerald-500/5',
    },
    {
      key: 'done',
      label: 'Completed',
      value: tc.done,
      help: tc.cancelled > 0 ? `${tc.cancelled} cancelled` : 'No cancelled work',
      className: 'border-sky-500/25 bg-sky-500/5',
    },
    {
      key: 'attention',
      label: 'Attention',
      value: attention,
      help: attention > 0 ? `${tc.failed} failed · ${tc.timed_out} timed out` : 'Healthy queue',
      className:
        attention > 0
          ? 'border-rose-500/25 bg-rose-500/5'
          : 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]',
    },
  ];
});
</script>
