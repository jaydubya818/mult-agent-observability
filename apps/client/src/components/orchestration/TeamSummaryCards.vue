<template>
  <div v-if="summary" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2">
    <div
      v-for="card in cards"
      :key="card.key"
      class="rounded-lg border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-3 py-2 text-center"
    >
      <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--theme-text-tertiary)]">{{ card.label }}</div>
      <div class="text-lg font-semibold tabular-nums text-[var(--theme-text-primary)]">{{ card.value }}</div>
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
  return [
    { key: 'agents', label: 'Agents', value: s.agent_count },
    {
      key: 'retry_max',
      label: 'Retry attempts (cap)',
      value: s.resolved_retry.max_attempts,
    },
    { key: 'backlog', label: 'Backlog', value: tc.backlog },
    { key: 'queued', label: 'Queued', value: tc.queued },
    { key: 'running', label: 'Running', value: tc.running },
    { key: 'done', label: 'Done', value: tc.done },
    { key: 'failed', label: 'Failed', value: tc.failed },
    { key: 'cancelled', label: 'Cancelled', value: tc.cancelled },
    { key: 'timed_out', label: 'Timed out', value: tc.timed_out },
  ];
});
</script>
