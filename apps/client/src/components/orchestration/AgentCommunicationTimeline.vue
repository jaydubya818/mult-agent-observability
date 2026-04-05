<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--theme-text-primary)]">Agent Communications</h3>
      <span class="text-xs text-[var(--theme-text-tertiary)]">{{ messages.length }} messages</span>
    </div>

    <div v-if="messages.length === 0" class="text-center py-6 text-[var(--theme-text-tertiary)] text-xs">
      No messages yet. Messages appear when agents use send_message to communicate.
    </div>

    <div v-else class="space-y-2 max-h-80 overflow-y-auto">
      <div
        v-for="msg in sortedMessages"
        :key="msg.id"
        class="rounded-lg border p-2.5 text-xs"
        :class="messageClass(msg.direction)"
      >
        <div class="flex items-center gap-2 mb-1">
          <span class="font-semibold text-[10px] uppercase tracking-wide" :class="directionTextClass(msg.direction)">
            {{ directionLabel(msg.direction) }}
          </span>
          <span class="text-[var(--theme-text-tertiary)]">·</span>
          <span class="font-semibold text-[10px] uppercase px-1.5 py-0.5 rounded" :class="kindClass(msg.kind)">{{ msg.kind }}</span>
          <span class="ml-auto text-[var(--theme-text-tertiary)]">{{ formatTime(msg.created_at) }}</span>
        </div>
        <div class="flex items-center gap-1 text-[var(--theme-text-tertiary)] mb-1.5 text-[10px]">
          <span v-if="msg.from_agent_id">{{ agentName(msg.from_agent_id) }}</span>
          <span v-if="msg.from_agent_id && msg.to_agent_id">→</span>
          <span v-if="msg.to_agent_id">{{ agentName(msg.to_agent_id) }}</span>
          <span v-if="!msg.from_agent_id && !msg.to_agent_id">broadcast</span>
        </div>
        <p class="text-[var(--theme-text-primary)] leading-relaxed line-clamp-3">{{ msg.body }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrchestrationMessage, OrchestrationAgent } from '../../orchestrationTypes';

const props = defineProps<{
  messages: OrchestrationMessage[];
  agents: OrchestrationAgent[];
}>();

const sortedMessages = computed(() => [...props.messages].sort((a, b) => b.created_at - a.created_at));

const agentMap = computed(() => {
  const m: Record<string, string> = {};
  for (const a of props.agents) m[a.id] = a.name;
  return m;
});

function agentName(id: string): string {
  return agentMap.value[id] ?? id.slice(0, 8);
}

function directionLabel(dir: string): string {
  if (dir === 'orchestrator_to_agent') return '→ Agent';
  if (dir === 'agent_to_orchestrator') return '← Orch';
  return '⊕ Broadcast';
}

function directionTextClass(dir: string): string {
  if (dir === 'orchestrator_to_agent') return 'text-blue-400';
  if (dir === 'agent_to_orchestrator') return 'text-emerald-400';
  return 'text-amber-400';
}

function messageClass(dir: string): string {
  const base = 'bg-[var(--theme-bg-primary)]';
  if (dir === 'orchestrator_to_agent') return `${base} border-blue-500/30`;
  if (dir === 'agent_to_orchestrator') return `${base} border-emerald-500/30`;
  return `${base} border-amber-500/30`;
}

function kindClass(kind: string): string {
  if (kind === 'directive') return 'bg-blue-500/10 text-blue-400';
  if (kind === 'report') return 'bg-emerald-500/10 text-emerald-400';
  return 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-tertiary)]';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>
