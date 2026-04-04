<template>
  <aside
    class="lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)]/70 p-3 overflow-y-auto max-h-48 lg:max-h-none"
  >
    <div class="space-y-2 mb-4">
      <label class="block text-xs font-semibold text-[var(--theme-text-tertiary)] uppercase tracking-wide">New team</label>
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
    </div>

    <p v-if="!snapshotReady" class="text-sm text-[var(--theme-text-tertiary)]">Waiting for orchestration snapshot…</p>
    <p v-else-if="!teams.length" class="text-sm text-[var(--theme-text-tertiary)]">No teams yet.</p>
    <ul v-else class="space-y-2">
      <li v-for="t in teams" :key="t.id">
        <button
          type="button"
          class="w-full text-left rounded-lg border px-3 py-2 transition-all text-sm"
          :class="
            t.id === selectedTeamId
              ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 shadow-sm'
              : 'border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] hover:border-[var(--theme-primary)]/40'
          "
          @click="$emit('select', t.id)"
        >
          <div class="font-medium truncate">{{ t.name }}</div>
          <div class="text-[10px] text-[var(--theme-text-tertiary)] mt-1 flex justify-between gap-2">
            <span>{{ executionLabel(t.execution_status) }}</span>
            <span>{{ summaryForTeam(t.id) }}</span>
          </div>
        </button>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
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

function summaryForTeam(teamId: string): string {
  const s = props.summaries.find((x) => x.id === teamId);
  if (!s) return '';
  const tc = s.task_counts;
  return `${s.agent_count} ag · ${tc.running} run · ${tc.queued} q`;
}
</script>
