<template>
  <header
    class="border-b border-[var(--theme-border-primary)] bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.8)),radial-gradient(circle_at_top_left,var(--theme-primary-light),transparent_42%)] px-4 py-4 backdrop-blur"
  >
    <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--theme-text-tertiary)]">
            Orchestration
          </p>
          <span
            v-if="selectedTeamName"
            class="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            :class="selectedTeamStatus === 'running' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-slate-400/30 bg-slate-500/10 text-slate-700'"
          >
            {{ selectedTeamStatus === 'running' ? 'Live team selected' : 'Stopped team selected' }}
          </span>
        </div>
        <div>
          <h2 class="text-xl font-semibold tracking-tight">
            {{ selectedTeamName ? `${selectedTeamName} mission control` : 'Parallel agent control plane' }}
          </h2>
          <p class="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--theme-text-tertiary)]">
            {{ selectedTeamName
              ? 'Tune retries, inspect task pressure, and steer agents without losing the operational picture.'
              : 'Create or select a team to manage retries, work queues, messages, and runtime health from one place.' }}
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-3 xl:items-end">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <article
            v-for="card in cards"
            :key="card.label"
            class="min-w-[7.5rem] rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/85 px-3 py-2 shadow-sm"
          >
            <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">
              {{ card.label }}
            </div>
            <div class="mt-1 text-xl font-semibold tracking-tight">
              {{ card.value }}
            </div>
            <div class="mt-1 text-[11px] text-[var(--theme-text-tertiary)]">
              {{ card.help }}
            </div>
          </article>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-xl text-sm font-medium bg-[var(--theme-accent-info)] text-white shadow hover:opacity-95"
            :disabled="disabled"
            @click="$emit('seed-demo')"
          >
            Seed 2×4 demo
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-xl text-sm font-medium border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] hover:bg-[var(--theme-hover-bg)]"
            :disabled="disabled"
            @click="$emit('refresh')"
          >
            Refresh snapshot
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrchestrationSummary } from '../../utils/commandCenterSummary';

const props = defineProps<{
  disabled?: boolean;
  summary: OrchestrationSummary;
  selectedTeamName?: string | null;
  selectedTeamStatus?: 'running' | 'stopped' | null;
}>();

defineEmits<{ 'seed-demo': []; refresh: [] }>();

const cards = computed(() => [
  {
    label: 'Running teams',
    value: props.summary.runningTeams,
    help: `${props.summary.totalTeams} total`,
  },
  {
    label: 'Tracked agents',
    value: props.summary.trackedAgents,
    help: 'All teams',
  },
  {
    label: 'Open work',
    value: props.summary.queuedTasks + props.summary.activeTasks,
    help: `${props.summary.activeTasks} executing`,
  },
  {
    label: 'Attention',
    value: props.summary.attentionTasks,
    help:
      props.summary.attentionTasks > 0
        ? 'Failed, blocked, or timed out'
        : 'No critical task issues',
  },
]);
</script>
