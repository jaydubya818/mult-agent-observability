<template>
  <aside
    class="lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)]/75 p-3 overflow-y-auto max-h-72 lg:max-h-none"
  >
    <div class="mb-4 space-y-3 rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/90 p-3 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--theme-text-tertiary)]">Teams</p>
          <h3 class="text-base font-semibold tracking-tight">Create or select a run space</h3>
        </div>
        <div class="text-right text-[11px] text-[var(--theme-text-tertiary)]">
          <div>{{ teams.length }} total</div>
          <div>{{ runningTeamCount }} running</div>
        </div>
      </div>

      <div class="flex gap-2">
        <input
          :value="newTeamName"
          class="flex-1 min-w-0 rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
          placeholder="Name"
          :disabled="disabled"
          @input="$emit('update:newTeamName', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="$emit('create-team')"
        />
        <button
          type="button"
          class="px-2 py-1.5 rounded-md bg-[var(--theme-primary)] text-white text-sm font-medium disabled:opacity-50"
          :disabled="!newTeamName.trim() || disabled"
          @click="$emit('create-team')"
        >
          Add
        </button>
      </div>

      <input
        v-model="teamSearch"
        class="w-full rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--theme-primary)]/30"
        placeholder="Search teams, descriptions, or IDs"
      />
    </div>

    <p v-if="!snapshotReady" class="text-sm text-[var(--theme-text-tertiary)]">Waiting for orchestration snapshot…</p>
    <p v-else-if="!teams.length" class="text-sm text-[var(--theme-text-tertiary)]">No teams yet.</p>
    <p v-else-if="!filteredTeams.length" class="text-sm text-[var(--theme-text-tertiary)]">
      No teams match the current search.
    </p>
    <ul v-else class="space-y-2">
      <li v-for="t in filteredTeams" :key="t.id">
        <button
          type="button"
          class="w-full text-left rounded-2xl border px-3 py-3 transition-all text-sm shadow-sm"
          :class="
            t.id === selectedTeamId
              ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)]/8 shadow-md'
              : 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] hover:border-[var(--theme-primary)]/40 hover:bg-[var(--theme-bg-primary)]'
          "
          @click="$emit('select', t.id)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium truncate">{{ t.name }}</div>
              <p class="mt-1 max-h-8 overflow-hidden text-[11px] leading-relaxed text-[var(--theme-text-tertiary)]">
                {{ t.description || 'No description yet.' }}
              </p>
            </div>
            <span
              class="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold"
              :class="t.execution_status === 'running' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-slate-500/10 text-slate-700'"
            >
              {{ executionLabel(t.execution_status) }}
            </span>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5 text-[10px] text-[var(--theme-text-tertiary)]">
            <span class="rounded-full border border-[var(--theme-border-secondary)] px-2 py-1">
              {{ summaryForTeam(t.id) }}
            </span>
            <span class="rounded-full border border-[var(--theme-border-secondary)] px-2 py-1 font-mono">
              {{ compactTeamId(t.id) }}
            </span>
          </div>
        </button>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { OrchestrationTeam, TeamSummary } from '../../orchestrationTypes';
import { executionLabel } from '../../utils/orchestrationFormat';

const props = defineProps<{
  teams: OrchestrationTeam[];
  selectedTeamId: string | null;
  newTeamName: string;
  disabled?: boolean;
  summaries: TeamSummary[];
  /** False until first snapshot received from WS or refresh. */
  snapshotReady: boolean;
}>();

defineEmits<{
  select: [teamId: string];
  'create-team': [];
  'update:newTeamName': [v: string];
}>();

const teamSearch = ref('');

const filteredTeams = computed(() => {
  const query = teamSearch.value.trim().toLowerCase();
  if (!query) return props.teams;
  return props.teams.filter((team) => {
    const haystack = [team.name, team.description ?? '', team.id].join(' ').toLowerCase();
    return haystack.includes(query);
  });
});

const runningTeamCount = computed(
  () => props.teams.filter((team) => team.execution_status === 'running').length
);

function summaryForTeam(teamId: string): string {
  const s = props.summaries.find((x) => x.id === teamId);
  if (!s) return '';
  const tc = s.task_counts;
  return `${s.agent_count} ag · ${tc.running} run · ${tc.queued} q`;
}

function compactTeamId(teamId: string): string {
  return teamId.length > 18 ? `${teamId.slice(0, 8)}…${teamId.slice(-4)}` : teamId;
}
</script>
