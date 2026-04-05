<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Agent filter</label>
      <select
        :value="statusFilter"
        class="rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1 text-xs"
        @change="$emit('update:statusFilter', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in AGENT_STATUS_FILTER_OPTIONS" :key="opt.label" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>
    <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
      <article
        v-for="a in filteredAgents"
        :key="a.id"
        role="button"
        tabindex="0"
        class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] p-3 shadow-sm cursor-pointer transition ring-offset-2 hover:border-[var(--theme-primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        :class="a.id === selectedAgentId ? 'ring-2 ring-[var(--theme-primary)]' : ''"
        @click="$emit('select-agent', a.id)"
        @keydown.enter="$emit('select-agent', a.id)"
      >
        <div class="flex justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-semibold truncate">{{ a.name }}</div>
            <div class="text-[11px] text-[var(--theme-text-tertiary)] uppercase tracking-wide">{{ a.role }}</div>
          </div>
          <div class="flex flex-col items-end gap-1 shrink-0">
            <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold" :class="agentStatusPillClass(a.status)">{{ a.status }}</span>
            <span v-if="(a as any).model_name" class="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold" :class="modelBadgeClass((a as any).model_name)">{{ modelLabel((a as any).model_name) }}</span>
          </div>
        </div>
        <!-- Context window progress bar -->
        <div v-if="(a as any).context_window_percent != null" class="mt-2">
          <div class="flex justify-between text-[10px] text-[var(--theme-text-tertiary)] mb-0.5">
            <span>Context</span>
            <span>{{ ((a as any).context_window_percent as number).toFixed(1) }}%</span>
          </div>
          <div class="h-1 rounded-full bg-[var(--theme-bg-tertiary)] overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="contextWindowBarClass((a as any).context_window_percent as number)"
              :style="{ width: Math.min((a as any).context_window_percent as number, 100) + '%' }"
            />
          </div>
        </div>
        <p class="text-[11px] text-[var(--theme-text-secondary)] mt-2">
          {{
            a.current_task_id
              ? `Task ${shortId(a.current_task_id)} — click for detail`
              : 'No active task'
          }}
        </p>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentStatus, OrchestrationAgent } from '../../orchestrationTypes';
import {
  AGENT_STATUS_FILTER_OPTIONS,
  agentStatusPillClass,
  shortId,
} from '../../utils/orchestrationFormat';

const props = defineProps<{
  agents: OrchestrationAgent[];
  statusFilter: '' | AgentStatus;
  selectedAgentId: string | null;
}>();

defineEmits<{
  'update:statusFilter': [v: string];
  'select-agent': [agentId: string];
}>();

const filteredAgents = computed(() => {
  if (!props.statusFilter) return props.agents;
  return props.agents.filter((a) => a.status === props.statusFilter);
});

function modelLabel(modelName: string): string {
  if (modelName.includes('haiku')) return 'Haiku';
  if (modelName.includes('sonnet')) return 'Sonnet';
  if (modelName.includes('opus')) return 'Opus';
  return modelName.split('/').pop()?.split('-').slice(0, 2).join('-') ?? modelName;
}

function modelBadgeClass(modelName: string): string {
  if (modelName.includes('haiku')) return 'bg-emerald-500/20 text-emerald-400';
  if (modelName.includes('sonnet')) return 'bg-blue-500/20 text-blue-400';
  if (modelName.includes('opus')) return 'bg-purple-500/20 text-purple-400';
  return 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)]';
}

function contextWindowBarClass(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-[var(--theme-primary)]';
}
</script>
