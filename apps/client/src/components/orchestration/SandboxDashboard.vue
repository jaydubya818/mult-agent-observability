<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--theme-text-primary)]">Agent Sandboxes</h3>
      <div class="flex items-center gap-2">
        <span class="text-xs text-[var(--theme-text-tertiary)]">{{ running }} running</span>
        <button
          class="text-xs px-2 py-1 rounded-md bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-quaternary)] border border-[var(--theme-border-secondary)] transition"
          @click="$emit('refresh')"
        >↻ Refresh</button>
      </div>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-lg bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] p-2">
        <div class="text-lg font-bold text-emerald-400">{{ running }}</div>
        <div class="text-[10px] text-[var(--theme-text-tertiary)] uppercase tracking-wide">Running</div>
      </div>
      <div class="rounded-lg bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] p-2">
        <div class="text-lg font-bold text-[var(--theme-text-secondary)]">{{ stopped }}</div>
        <div class="text-[10px] text-[var(--theme-text-tertiary)] uppercase tracking-wide">Stopped</div>
      </div>
      <div class="rounded-lg bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] p-2">
        <div class="text-lg font-bold text-[var(--theme-text-primary)]">{{ sandboxes.length }}</div>
        <div class="text-[10px] text-[var(--theme-text-tertiary)] uppercase tracking-wide">Total</div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="sandboxes.length === 0" class="text-center py-8 text-[var(--theme-text-tertiary)] text-sm">
      No sandboxes detected yet. Sandbox events are captured automatically when agents use E2B tools.
    </div>

    <!-- Sandbox list -->
    <div v-else class="space-y-2 max-h-72 overflow-y-auto">
      <div
        v-for="s in sandboxes"
        :key="s.id"
        class="rounded-lg border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] p-3 text-xs"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-mono font-semibold truncate text-[var(--theme-text-primary)]">{{ s.id }}</div>
            <div class="text-[var(--theme-text-tertiary)] mt-0.5">
              {{ s.provider }} · {{ s.template_id ?? 'default' }}
            </div>
          </div>
          <span
            class="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold"
            :class="sandboxStatusClass(s.status)"
          >{{ s.status }}</span>
        </div>
        <div v-if="s.url" class="mt-2">
          <a
            :href="s.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[var(--theme-primary)] hover:underline font-mono truncate block"
          >{{ s.url }}</a>
        </div>
        <div class="flex items-center gap-3 mt-2 text-[var(--theme-text-tertiary)]">
          <span v-if="s.session_id">Session: {{ s.session_id.slice(0, 8) }}</span>
          <span>{{ new Date(s.created_at).toLocaleTimeString() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SandboxRecord } from '../../orchestrationTypes';

const props = defineProps<{
  sandboxes: SandboxRecord[];
}>();

defineEmits<{ refresh: [] }>();

const running = computed(() => props.sandboxes.filter(s => s.status === 'running').length);
const stopped = computed(() => props.sandboxes.filter(s => s.status === 'stopped').length);

function sandboxStatusClass(status: string): string {
  if (status === 'running') return 'bg-emerald-500/20 text-emerald-400';
  if (status === 'error') return 'bg-red-500/20 text-red-400';
  return 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)]';
}
</script>
