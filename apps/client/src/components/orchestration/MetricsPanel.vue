<template>
  <div class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/70 p-3">
    <h4 class="text-xs font-bold uppercase tracking-wide text-[var(--theme-text-tertiary)] mb-2">Metrics (recent)</h4>
    <ul class="space-y-1.5 text-xs max-h-40 overflow-y-auto">
      <li v-for="m in displayed" :key="m.id" class="flex justify-between gap-2">
        <span class="text-[var(--theme-text-secondary)] truncate">{{ m.key }}</span>
        <span class="font-mono shrink-0">{{ m.value }} {{ m.unit }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrchestrationMetric } from '../../orchestrationTypes';

const props = defineProps<{
  metrics: OrchestrationMetric[];
  maxRows?: number;
}>();

const displayed = computed(() => {
  const n = props.maxRows ?? 12;
  return props.metrics.slice(-n).reverse();
});
</script>
