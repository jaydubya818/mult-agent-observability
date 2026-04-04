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
          <div>
            <div class="text-sm font-semibold">{{ a.name }}</div>
            <div class="text-[11px] text-[var(--theme-text-tertiary)] uppercase tracking-wide">{{ a.role }}</div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold" :class="agentStatusPillClass(a.status)">{{ a.status }}</span>
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
</script>
