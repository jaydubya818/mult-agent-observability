<template>
  <details
    ref="detailsRoot"
    class="px-4 py-2 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)]/50 text-[10px]"
    @toggle="onToggle"
  >
    <summary class="cursor-pointer font-semibold text-[var(--theme-text-secondary)] select-none">
      Run history
      <span class="font-normal text-[var(--theme-text-tertiary)]">(archived terminal runs)</span>
    </summary>
    <p class="text-[var(--theme-text-tertiary)] mt-2 leading-snug">
      Read-only log of completed executions. Live in-flight runs stay in the snapshot / task detail only.
    </p>
    <div v-if="open" class="mt-3 flex flex-wrap items-end gap-2">
      <label class="flex flex-col gap-0.5 text-[var(--theme-text-tertiary)]">
        Team
        <select
          v-model="filterTeamId"
          class="rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono text-[10px] min-w-[8rem]"
        >
          <option value="">All teams</option>
          <option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5 text-[var(--theme-text-tertiary)]">
        Status
        <select
          v-model="filterStatus"
          class="rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[10px]"
        >
          <option value="">Any</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="timed_out">timed_out</option>
          <option value="policy_rejected">policy_rejected</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5 text-[var(--theme-text-tertiary)] min-w-[8rem]">
        Task id
        <input
          v-model="filterTaskId"
          type="text"
          autocomplete="off"
          placeholder="UUID or prefix…"
          class="w-full min-w-[10rem] rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono text-[10px]"
          @keydown.enter.prevent="load"
        />
      </label>
      <label class="flex flex-col gap-0.5 text-[var(--theme-text-tertiary)] min-w-[8rem] flex-1">
        Search (stdout / stderr / error)
        <input
          v-model="filterQ"
          type="search"
          placeholder="substring…"
          class="w-full max-w-xs rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono text-[10px]"
          @keydown.enter.prevent="load"
        />
      </label>
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-[10px] font-semibold bg-[var(--theme-accent-info)] text-[var(--theme-bg-primary)] disabled:opacity-50"
        :disabled="loading"
        @click="load"
      >
        Refresh
      </button>
      <span v-if="total != null" class="text-[var(--theme-text-tertiary)] pb-1">
        {{ total }} row(s), page {{ page }} / {{ totalPages || 1 }}
      </span>
    </div>
    <p v-if="open && error" class="mt-2 text-[var(--theme-accent-error)]">{{ error }}</p>
    <p v-if="open && loading" class="mt-2 text-[var(--theme-text-tertiary)]">Loading…</p>
    <div v-if="open && !loading && rows.length" class="mt-2 overflow-x-auto max-h-64 overflow-y-auto border border-[var(--theme-border-tertiary)] rounded">
      <table class="w-full text-left font-mono text-[9px] border-collapse">
        <thead class="sticky top-0 bg-[var(--theme-bg-primary)]/95 text-[var(--theme-text-tertiary)]">
          <tr>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Finished</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Status</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Task</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Team</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Att</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Exit</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Adapter</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Reason</th>
            <th class="p-1 border-b border-[var(--theme-border-secondary)]">Preview</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.history_id"
            class="cursor-pointer hover:bg-[var(--theme-bg-primary)]/40 border-b border-[var(--theme-border-tertiary)]/40"
            @click="emit('open-task', { taskId: r.task_id, teamId: r.team_id })"
          >
            <td class="p-1 whitespace-nowrap text-[var(--theme-text-secondary)]">{{ formatTime(r.finished_at) }}</td>
            <td class="p-1">{{ r.status }}</td>
            <td class="p-1 max-w-[10rem] truncate" :title="r.task_id">{{ taskLabel(r.task_id) }}</td>
            <td class="p-1 max-w-[8rem] truncate" :title="r.team_id">{{ teamLabel(r.team_id) }}</td>
            <td class="p-1">{{ r.attempt }}</td>
            <td class="p-1">{{ r.exit_code ?? '—' }}</td>
            <td class="p-1">{{ r.environment_kind }}</td>
            <td class="p-1 max-w-[6rem] truncate" :title="r.termination_reason ?? ''">
              {{ r.termination_reason ?? '—' }}
            </td>
            <td class="p-1 max-w-[14rem] truncate text-[var(--theme-text-tertiary)]" :title="previewFull(r)">
              {{ previewShort(r) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="open && !loading && !rows.length && loadedOnce" class="mt-2 text-[var(--theme-text-tertiary)]">
      No rows match.
    </div>
    <div v-if="open && totalPages > 1" class="mt-2 flex gap-2">
      <button
      type="button"
        class="rounded border border-[var(--theme-border-secondary)] px-2 py-0.5 disabled:opacity-40"
        :disabled="page <= 1 || loading"
        @click="page--; load()"
      >
        Prev
      </button>
      <button
        type="button"
        class="rounded border border-[var(--theme-border-secondary)] px-2 py-0.5 disabled:opacity-40"
        :disabled="page >= totalPages || loading"
        @click="page++; load()"
      >
        Next
      </button>
    </div>
  </details>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { OrchestrationTeam, OrchestrationTask, TaskRunHistoryRecord } from '../../orchestrationTypes';
import { useOrchestrationApi } from '../../composables/useOrchestrationApi';
import { normalizedOptionalTaskId } from '../../utils/taskRunHistoryDisplay';

const emit = defineEmits<{ 'open-task': [payload: { taskId: string; teamId: string }] }>();

const props = defineProps<{
  teams: OrchestrationTeam[];
  tasks: OrchestrationTask[];
  /** When set, initializes team filter; user can clear to “all”. */
  selectedTeamId: string | null;
}>();

const api = useOrchestrationApi();
const open = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const rows = ref<TaskRunHistoryRecord[]>([]);
const total = ref<number | null>(null);
const limit = 15;
const page = ref(1);
const loadedOnce = ref(false);

const filterTeamId = ref('');
const filterTaskId = ref('');
const filterStatus = ref('');
const filterQ = ref('');
const detailsRoot = ref<HTMLDetailsElement | null>(null);

watch(
  () => props.selectedTeamId,
  (id) => {
    filterTeamId.value = id ?? '';
  },
  { immediate: true }
);

/**
 * Open the main Run history panel, pre-fill task (and optionally team), fetch, scroll into view.
 * Exposed for TaskDetailPanel handoff.
 */
async function openForTask(taskId: string, teamId?: string) {
  filterTaskId.value = taskId.trim();
  if (teamId && teamId.trim() !== '') {
    filterTeamId.value = teamId.trim();
  }
  page.value = 1;
  open.value = true;
  const el = detailsRoot.value;
  if (el) el.open = true;
  await load();
  await nextTick();
  detailsRoot.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

defineExpose({ openForTask });

function teamLabel(teamId: string): string {
  const t = props.teams.find((x) => x.id === teamId);
  return t ? t.name : teamId.slice(0, 8);
}

function taskLabel(taskId: string): string {
  const t = props.tasks.find((x) => x.id === taskId);
  return t ? t.title : taskId.slice(0, 8);
}

function formatTime(ts: number | null): string {
  if (ts == null) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function previewShort(r: TaskRunHistoryRecord): string {
  const parts = [r.error_message, r.stderr_tail, r.stdout_tail].filter(Boolean) as string[];
  const s = parts[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return s.length > 120 ? `${s.slice(0, 117)}…` : s || '—';
}

function previewFull(r: TaskRunHistoryRecord): string {
  return [r.error_message, r.stderr_tail, r.stdout_tail].filter(Boolean).join('\n---\n');
}

const totalPages = ref(1);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const offset = (page.value - 1) * limit;
    const res = await api.listTaskRunHistory({
      team_id: filterTeamId.value || undefined,
      task_id: normalizedOptionalTaskId(filterTaskId.value),
      status: filterStatus.value || undefined,
      q: filterQ.value.trim() || undefined,
      limit,
      offset,
    });
    rows.value = res.runs;
    total.value = res.total;
    totalPages.value = Math.max(1, Math.ceil(res.total / limit));
    loadedOnce.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

function onToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement;
  open.value = el.open;
  if (el.open && !loadedOnce.value) {
    page.value = 1;
    load();
  }
}
</script>
