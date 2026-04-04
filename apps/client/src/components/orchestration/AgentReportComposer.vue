<template>
  <div class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/70 p-3 flex flex-col gap-2">
    <h4 class="text-xs font-bold uppercase tracking-wide text-[var(--theme-text-tertiary)]">Agent → orchestrator</h4>
    <textarea
      :value="body"
      rows="2"
      class="w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-sm"
      placeholder="Agent report…"
      :disabled="disabled"
      @input="$emit('update:body', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex gap-2 flex-wrap items-center">
      <select
        :value="agentId"
        class="flex-1 min-w-[140px] rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-xs"
        :disabled="disabled"
        @change="$emit('update:agentId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">Select agent</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg bg-[var(--theme-accent-success)] text-white text-xs font-semibold disabled:opacity-50"
        :disabled="!body.trim() || !agentId || disabled"
        @click="$emit('send')"
      >
        Report
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OrchestrationAgent } from '../../orchestrationTypes';

defineProps<{
  agents: OrchestrationAgent[];
  body: string;
  agentId: string;
  disabled?: boolean;
}>();

defineEmits<{
  'update:body': [v: string];
  'update:agentId': [v: string];
  send: [];
}>();
</script>
