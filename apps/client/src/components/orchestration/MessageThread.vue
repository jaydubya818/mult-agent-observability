<template>
  <div class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/70 p-3 flex flex-col gap-2">
    <h4 class="text-xs font-bold uppercase tracking-wide text-[var(--theme-text-tertiary)]">{{ title }}</h4>
    <textarea
      :value="composerBody"
      rows="2"
      class="w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-sm"
      :placeholder="composerPlaceholder"
      :disabled="disabled"
      @input="$emit('update:composerBody', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="flex gap-2 flex-wrap items-center">
      <select
        :value="toAgentId"
        class="flex-1 min-w-[140px] rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-xs"
        :disabled="disabled"
        @change="$emit('update:toAgentId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">Broadcast to team</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg bg-[var(--theme-accent-info)] text-white text-xs font-semibold disabled:opacity-50"
        :disabled="!composerBody.trim() || disabled"
        @click="$emit('send-orchestrator')"
      >
        Send
      </button>
    </div>
    <div class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/50 p-2">
      <h5 class="text-[10px] font-bold uppercase text-[var(--theme-text-tertiary)] mb-2">Message log</h5>
      <ul class="space-y-2 max-h-56 overflow-y-auto text-xs">
        <li
          v-for="msg in messages"
          :key="msg.id"
          class="border-l-2 pl-2 border-[var(--theme-border-secondary)]"
          :style="{ borderColor: messageDirectionColor(msg.direction) }"
        >
          <div class="text-[10px] text-[var(--theme-text-tertiary)] flex justify-between gap-2">
            <span>{{ msg.direction }}</span>
            <span>{{ formatOrchestrationTime(msg.created_at) }}</span>
          </div>
          <div class="text-[var(--theme-text-secondary)] whitespace-pre-wrap">{{ msg.body }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OrchestrationAgent, OrchestrationMessage } from '../../orchestrationTypes';
import {
  formatOrchestrationTime,
  messageDirectionColor,
} from '../../utils/orchestrationFormat';

defineProps<{
  title: string;
  composerPlaceholder: string;
  composerBody: string;
  toAgentId: string;
  agents: OrchestrationAgent[];
  messages: OrchestrationMessage[];
  disabled?: boolean;
}>();

defineEmits<{
  'update:composerBody': [v: string];
  'update:toAgentId': [v: string];
  'send-orchestrator': [];
}>();
</script>
