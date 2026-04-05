<template>
  <div class="orch-root min-h-full flex flex-col bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)]">
    <TeamToolbar :disabled="busy" @seed-demo="runSeedDemo" @refresh="refreshSnapshot" />
    <details class="px-4 py-2 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)]/60 text-[10px]" @toggle="onAdminAuditToggle">
      <summary class="cursor-pointer font-semibold text-[var(--theme-text-secondary)] select-none">
        Recent admin mutations
      </summary>
      <p class="text-[var(--theme-text-tertiary)] mt-2 leading-snug">
        Read-only audit log (policy changes, demo seed, team policy assignment). Open the panel to load.
      </p>
      <p v-if="adminAuditLoading" class="mt-2 text-[var(--theme-text-tertiary)]">Loading…</p>
      <ul v-else-if="adminAuditRows.length" class="mt-2 space-y-1.5 max-h-36 overflow-y-auto font-mono text-[10px]">
        <li
          v-for="a in adminAuditRows"
          :key="a.id"
          class="border-b border-[var(--theme-border-tertiary)]/50 pb-1 text-[var(--theme-text-secondary)]"
        >
          <span :class="auditOutcomeClass(a.outcome)">{{ a.outcome }}</span>
          · {{ a.action }}
          <span v-if="a.target_entity_id" class="text-[var(--theme-text-tertiary)]"> · {{ shortId(a.target_entity_id) }}</span>
          · {{ formatAuditTime(a.created_at) }}
        </li>
      </ul>
      <p v-else class="mt-2 text-[var(--theme-text-tertiary)]">No rows loaded.</p>
    </details>

    <div class="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      <TeamList
        :snapshot-ready="snapshotReady"
        :teams="snapshot?.teams ?? []"
        :summaries="snapshot?.team_summaries ?? []"
        :selected-team-id="selectedTeamId"
        v-model:new-team-name="newTeamName"
        :disabled="busy"
        @select="selectedTeamId = $event"
        @create-team="createTeam"
      />

      <section v-if="activeTeam" class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div
          class="px-4 py-3 border-b border-[var(--theme-border-primary)] flex flex-wrap items-center gap-3 justify-between bg-[var(--theme-bg-secondary)]/80"
        >
          <div>
            <h3 class="text-base font-semibold">{{ activeTeam.name }}</h3>
            <p class="text-xs text-[var(--theme-text-tertiary)]">
              {{ activeTeam.description || 'No description' }}
            </p>
            <p class="text-[10px] text-[var(--theme-text-tertiary)] mt-1">
              Execution adapter:
              <span class="font-mono text-[var(--theme-text-secondary)]">{{ executionKind }}</span>
            </p>
            <p v-if="executionKind === 'local_process' && teamPolicyLine" class="text-[10px] text-[var(--theme-text-tertiary)] mt-0.5">
              Policy:
              <span class="font-mono text-[var(--theme-text-secondary)]">{{ teamPolicyLine }}</span>
            </p>
            <div
              v-if="executionKind === 'local_process' || (snapshot?.execution_policies?.length ?? 0) > 0"
              class="mt-2 max-w-md rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/40 p-2 space-y-2 text-[10px]"
            >
              <div class="font-semibold text-[var(--theme-text-secondary)]">Orchestration admin token</div>
              <p class="text-[var(--theme-text-tertiary)] leading-snug">
                Used for audited routes (policy assignment, policy retry save, …) when the server sets
                <span class="font-mono">ORCH_ADMIN_TOKEN</span>. Stored in this tab only.
              </p>
              <label class="block text-[var(--theme-text-tertiary)]">Admin token</label>
              <input
                v-model="orchAdminTokenLocal"
                type="password"
                autocomplete="off"
                class="w-full rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono text-[10px]"
                placeholder="Optional unless server enforces ORCH_ADMIN_TOKEN"
              />
              <template v-if="executionKind === 'local_process'">
                <div class="font-semibold text-[var(--theme-text-secondary)] pt-1">Assign execution policy</div>
                <div class="flex flex-wrap items-center gap-2">
                  <select
                    v-model="policyAssignSelection"
                    class="flex-1 min-w-[10rem] rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[10px]"
                  >
                    <option value="">— Env defaults (clear team policy) —</option>
                    <option v-for="p in snapshot?.execution_policies ?? []" :key="p.id" :value="p.id">
                      {{ p.name }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="rounded-lg px-2 py-1 text-[10px] font-semibold bg-[var(--theme-accent-info)] text-[var(--theme-bg-primary)] disabled:opacity-50"
                    :disabled="busy"
                    @click="applyTeamPolicyAssignment"
                  >
                    Apply
                  </button>
                </div>
              </template>
            </div>

            <TeamRetryConfigPanel
              v-if="activeTeam"
              :team="activeTeam"
              :disabled="busy"
              @apply="saveTeamRetry"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="activeTeam.execution_status !== 'running'"
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--theme-accent-success)] text-white"
              :disabled="busy"
              @click="startTeam"
            >
              Start parallel run
            </button>
            <button
              v-else
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--theme-accent-warning)] text-[var(--theme-bg-primary)]"
              :disabled="busy"
              @click="stopTeam"
            >
              Stop execution
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--theme-accent-error)]/50 text-[var(--theme-accent-error)]"
              :disabled="busy"
              @click="deleteSelectedTeam"
            >
              Delete team
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <TeamSummaryCards :summary="activeTeamSummary" />

          <PolicyRetryConfigList
            :policies="snapshot?.execution_policies ?? []"
            :disabled="busy"
            @apply="savePolicyRetry"
          />

          <OrchestrationAgentSwimlanes
            :agents="agentsForTeam"
            v-model:status-filter="agentStatusFilter"
            :selected-agent-id="selectedAgentIdForFilter"
            @select-agent="onSelectAgentForFilter"
          />
          <p v-if="selectedAgentIdForFilter" class="text-[10px] text-[var(--theme-text-tertiary)]">
            Event feed filtered to
            <span class="font-mono">{{ agentFilterLabel }}</span>
            —
            <button type="button" class="text-[var(--theme-accent-info)] underline" @click="clearAgentFilter">Clear</button>
          </p>

          <div class="grid xl:grid-cols-3 gap-4">
            <div class="xl:col-span-2 space-y-3">
              <TaskBoard
                :columns="taskColumns"
                :tasks-by-status="tasksByStatus"
                v-model:new-task-title="newTaskTitle"
                v-model:new-task-priority="newTaskPriority"
                v-model:process-command="newTaskShellCommand"
                :show-process-command="executionKind === 'local_process'"
                :disabled="busy"
                @add-task="addTask"
                @open-task="openTaskDetail"
              />
            </div>

            <div class="space-y-4">
              <MetricsPanel :metrics="metricsForTeam" />
              <AgentReportComposer
                :agents="agentsForTeam"
                v-model:body="agentReportBody"
                v-model:agent-id="agentReportAgentId"
                :disabled="busy"
                @send="sendAgentReport"
              />
              <MessageThread
                title="Orchestrator → agents"
                composer-placeholder="Directive to agents…"
                :agents="agentsForTeam"
                v-model:composer-body="orchMessage"
                v-model:to-agent-id="orchTargetAgentId"
                :messages="messagesForTeam"
                :disabled="busy"
                @send-orchestrator="sendOrchestratorMessage"
              />
              <OrchestrationEventFeed
                v-if="selectedTeamId"
                :hook-events="hookEvents"
                :team-id="selectedTeamId"
                v-model:hook-type-filter="hookTypeFilter"
                :agent-id-filter="selectedAgentIdForFilter"
                :task-id-filter="taskHookFilterTaskId"
                @clear-task-filter="taskHookFilterTaskId = null"
              />
            </div>
          </div>
        </div>
      </section>

      <div
        v-else-if="!snapshot"
        class="flex-1 flex items-center justify-center text-sm text-[var(--theme-text-tertiary)] p-8"
      >
        Waiting for orchestration snapshot…
      </div>
      <div
        v-else-if="snapshot.teams.length === 0"
        class="flex-1 flex items-center justify-center text-sm text-[var(--theme-text-tertiary)] p-8"
      >
        Create a team to orchestrate parallel work and watch live status.
      </div>
      <div v-else class="flex-1 flex items-center justify-center text-sm text-[var(--theme-text-tertiary)] p-8">
        Select a team to orchestrate parallel work and watch live status.
      </div>
    </div>

    <TaskDetailPanel
      :open="taskDetailOpen"
      :task="selectedTask"
      :transitions="transitionsForSelectedTask"
      :agents="agentsForTeam"
      :task-run="selectedTaskRun"
      :execution-environment-kind="executionKind"
      :can-cancel-task="!!selectedTask && selectedTask.status === 'running' && activeTeam?.execution_status === 'running'"
      :cancel-busy="busy"
      @close="closeTaskDetail"
      @cancel-task="cancelSelectedTask"
      @filter-events-to-task="onFilterEventsToTask"
    />

    <p
      v-if="orchError"
      class="text-xs text-[var(--theme-accent-error)] px-4 py-2 border-t border-[var(--theme-border-primary)]"
    >
      {{ orchError }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { HookEvent } from '../../types';
import type {
  AdminAuditRecord,
  AgentStatus,
  OrchestrationSnapshot,
  OrchestrationTask,
  TaskStatus,
} from '../../orchestrationTypes';
import { useOrchestrationApi } from '../../composables/useOrchestrationApi';
import TeamToolbar from './TeamToolbar.vue';
import TeamList from './TeamList.vue';
import TeamSummaryCards from './TeamSummaryCards.vue';
import OrchestrationAgentSwimlanes from './OrchestrationAgentSwimlanes.vue';
import TaskBoard from './TaskBoard.vue';
import MessageThread from './MessageThread.vue';
import AgentReportComposer from './AgentReportComposer.vue';
import MetricsPanel from './MetricsPanel.vue';
import OrchestrationEventFeed from './OrchestrationEventFeed.vue';
import TaskDetailPanel from './TaskDetailPanel.vue';
import TeamRetryConfigPanel from './TeamRetryConfigPanel.vue';
import PolicyRetryConfigList from './PolicyRetryConfigList.vue';

const emit = defineEmits<{ snapshot: [OrchestrationSnapshot] }>();

const props = defineProps<{
  snapshot: OrchestrationSnapshot | null;
  hookEvents: HookEvent[];
}>();

const api = useOrchestrationApi();
const busy = ref(false);
const orchError = ref<string | null>(null);
const newTeamName = ref('');
const selectedTeamId = ref<string | null>(null);
const newTaskTitle = ref('');
const newTaskPriority = ref(2);
const newTaskShellCommand = ref('');
const orchMessage = ref('');
const orchTargetAgentId = ref('');
const agentReportBody = ref('');
const agentReportAgentId = ref('');
const agentStatusFilter = ref<AgentStatus | ''>('');
const selectedAgentIdForFilter = ref<string | null>(null);
const hookTypeFilter = ref('');
const taskHookFilterTaskId = ref<string | null>(null);
const taskDetailOpen = ref(false);
const selectedTaskId = ref<string | null>(null);

const ORCH_ADMIN_STORAGE_KEY = 'orchestration_admin_token';
const orchAdminTokenLocal = ref('');
const policyAssignSelection = ref('');
const adminAuditRows = ref<AdminAuditRecord[]>([]);
const adminAuditLoading = ref(false);

const snapshotReady = computed(() => props.snapshot !== null);

const executionKind = computed(
  () => props.snapshot?.execution_environment_kind ?? 'simulated'
);

/** Compact guardrail summary for local_process (persisted team policy or env fallback). */
const teamPolicyLine = computed(() => {
  if (!activeTeam.value || executionKind.value !== 'local_process') return '';
  const tid = activeTeam.value.execution_policy_id;
  const policies = props.snapshot?.execution_policies ?? [];
  if (!tid) {
    return 'env / defaults (no team policy)';
  }
  const p = policies.find((x) => x.id === tid);
  if (!p) return `id ${tid.slice(0, 8)}… (missing row)`;
  return `${p.name} · max ${Math.round(p.max_ms / 1000)}s · ${p.max_concurrent} concurrent`;
});

watch(
  () => props.snapshot,
  (snap) => {
    if (!snap?.teams.length) {
      selectedTeamId.value = null;
      return;
    }
    if (!selectedTeamId.value || !snap.teams.some((t) => t.id === selectedTeamId.value)) {
      selectedTeamId.value = snap.teams[0].id;
    }
  },
  { immediate: true }
);

watch(selectedTeamId, () => {
  selectedAgentIdForFilter.value = null;
  hookTypeFilter.value = '';
  taskHookFilterTaskId.value = null;
});

const activeTeam = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return null;
  return props.snapshot.teams.find((t) => t.id === selectedTeamId.value) ?? null;
});

watch(
  activeTeam,
  (t) => {
    policyAssignSelection.value = t?.execution_policy_id ?? '';
  },
  { immediate: true }
);

onMounted(() => {
  try {
    orchAdminTokenLocal.value = sessionStorage.getItem(ORCH_ADMIN_STORAGE_KEY) ?? '';
  } catch {
    /* ignore */
  }
});

watch(orchAdminTokenLocal, (v) => {
  try {
    if (v) sessionStorage.setItem(ORCH_ADMIN_STORAGE_KEY, v);
    else sessionStorage.removeItem(ORCH_ADMIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

const activeTeamSummary = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return null;
  return props.snapshot.team_summaries.find((s) => s.id === selectedTeamId.value) ?? null;
});

const agentsForTeam = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return [];
  return props.snapshot.agents.filter((a) => a.team_id === selectedTeamId.value);
});

const tasksForTeam = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return [];
  return props.snapshot.tasks.filter((t) => t.team_id === selectedTeamId.value);
});

const messagesForTeam = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return [];
  return props.snapshot.messages.filter((m) => m.team_id === selectedTeamId.value).slice(-80).reverse();
});

const metricsForTeam = computed(() => {
  if (!props.snapshot || !selectedTeamId.value) return [];
  return props.snapshot.metrics.filter((m) => m.team_id === selectedTeamId.value);
});

const taskColumns: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'queued', label: 'Queued' },
  { status: 'running', label: 'Running' },
  { status: 'done', label: 'Done' },
  { status: 'failed', label: 'Failed' },
  { status: 'cancelled', label: 'Cancelled' },
  { status: 'timed_out', label: 'Timed out' },
];

const tasksByStatus = computed(() => {
  const map: Record<TaskStatus, OrchestrationTask[]> = {
    backlog: [],
    queued: [],
    running: [],
    blocked: [],
    done: [],
    failed: [],
    cancelled: [],
    timed_out: [],
  };
  for (const t of tasksForTeam.value) {
    map[t.status].push(t);
  }
  return map;
});

const selectedTask = computed(() => {
  if (!selectedTaskId.value) return null;
  return tasksForTeam.value.find((t) => t.id === selectedTaskId.value) ?? null;
});

const transitionsForSelectedTask = computed(() => {
  if (!props.snapshot || !selectedTaskId.value || !selectedTeamId.value) return [];
  const all = props.snapshot.task_transitions ?? [];
  return all.filter((tr) => tr.task_id === selectedTaskId.value && tr.team_id === selectedTeamId.value);
});

const selectedTaskRun = computed(() => {
  if (!props.snapshot?.task_runs?.length || !selectedTaskId.value) return null;
  return props.snapshot.task_runs.find((r) => r.task_id === selectedTaskId.value) ?? null;
});

const agentFilterLabel = computed(() => {
  if (!selectedAgentIdForFilter.value) return '';
  const a = agentsForTeam.value.find((x) => x.id === selectedAgentIdForFilter.value);
  return a ? `${a.name} (${selectedAgentIdForFilter.value.slice(0, 8)}…)` : selectedAgentIdForFilter.value.slice(0, 8);
});

function onSelectAgentForFilter(agentId: string) {
  selectedAgentIdForFilter.value = selectedAgentIdForFilter.value === agentId ? null : agentId;
}

function clearAgentFilter() {
  selectedAgentIdForFilter.value = null;
}

function openTaskDetail(taskId: string) {
  selectedTaskId.value = taskId;
  taskDetailOpen.value = true;
}

function closeTaskDetail() {
  taskDetailOpen.value = false;
}

function onFilterEventsToTask(taskId: string) {
  taskHookFilterTaskId.value = taskId;
  hookTypeFilter.value = '';
}

async function onAdminAuditToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement;
  if (!el.open) return;
  adminAuditLoading.value = true;
  orchError.value = null;
  try {
    const { records } = await api.listAdminAudit({ limit: 30 }, orchAdminTokenLocal.value || undefined);
    adminAuditRows.value = records;
  } catch (e) {
    orchError.value = e instanceof Error ? e.message : String(e);
  } finally {
    adminAuditLoading.value = false;
  }
}

function formatAuditTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function auditOutcomeClass(outcome: AdminAuditRecord['outcome']): string {
  switch (outcome) {
    case 'success':
      return 'text-[var(--theme-accent-success)] font-semibold';
    case 'denied':
      return 'text-[var(--theme-accent-error)] font-semibold';
    case 'invalid':
      return 'text-[var(--theme-accent-warning)] font-semibold';
    default:
      return '';
  }
}

async function runWithError(fn: () => Promise<void>) {
  orchError.value = null;
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    orchError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function refreshSnapshot() {
  await runWithError(async () => {
    const snap: OrchestrationSnapshot = await api.fetchSnapshot();
    emit('snapshot', snap);
  });
}

async function applyTeamPolicyAssignment() {
  if (!activeTeam.value) return;
  const id = policyAssignSelection.value === '' ? null : policyAssignSelection.value;
  await runWithError(async () => {
    await api.setTeamExecutionPolicy(
      activeTeam.value!.id,
      id,
      orchAdminTokenLocal.value || undefined
    );
    const snap: OrchestrationSnapshot = await api.fetchSnapshot();
    emit('snapshot', snap);
  });
}

async function saveTeamRetry(patch: Record<string, unknown>) {
  if (!activeTeam.value) return;
  await runWithError(async () => {
    await api.patchTeam(activeTeam.value!.id, patch, orchAdminTokenLocal.value || undefined);
    const snap: OrchestrationSnapshot = await api.fetchSnapshot();
    emit('snapshot', snap);
  });
}

async function savePolicyRetry(policyId: string, patch: Record<string, unknown>) {
  await runWithError(async () => {
    await api.patchExecutionPolicy(policyId, patch, orchAdminTokenLocal.value || undefined);
    const snap: OrchestrationSnapshot = await api.fetchSnapshot();
    emit('snapshot', snap);
  });
}

async function runSeedDemo() {
  await runWithError(async () => {
    await api.seedDemo(undefined, orchAdminTokenLocal.value || undefined);
  });
}

async function createTeam() {
  const name = newTeamName.value.trim();
  if (!name) return;
  await runWithError(async () => {
    await api.createTeam(name);
    newTeamName.value = '';
  });
}

async function deleteSelectedTeam() {
  if (!activeTeam.value) return;
  if (!confirm(`Delete team "${activeTeam.value.name}" and all related agents/tasks?`)) return;
  await runWithError(async () => {
    await api.deleteTeam(activeTeam.value!.id);
  });
}

async function addTask() {
  if (!activeTeam.value || !newTaskTitle.value.trim()) return;
  await runWithError(async () => {
    const shell = newTaskShellCommand.value.trim();
    const payload =
      executionKind.value === 'local_process' && shell
        ? { command: ['sh', '-c', shell] }
        : undefined;
    await api.createTask(activeTeam.value!.id, {
      title: newTaskTitle.value.trim(),
      priority: newTaskPriority.value,
      ...(payload ? { payload } : {}),
    });
    newTaskTitle.value = '';
    newTaskShellCommand.value = '';
  });
}

async function cancelSelectedTask() {
  if (!selectedTask.value || selectedTask.value.status !== 'running') return;
  await runWithError(async () => {
    await api.cancelTask(selectedTask.value!.id);
  });
}

async function startTeam() {
  if (!activeTeam.value) return;
  await runWithError(async () => {
    await api.startExecution(activeTeam.value!.id);
  });
}

async function stopTeam() {
  if (!activeTeam.value) return;
  await runWithError(async () => {
    await api.stopExecution(activeTeam.value!.id);
  });
}

async function sendAgentReport() {
  if (!activeTeam.value || !agentReportBody.value.trim() || !agentReportAgentId.value) return;
  await runWithError(async () => {
    await api.postMessage(activeTeam.value!.id, agentReportBody.value.trim(), 'agent_to_orchestrator', {
      from_agent_id: agentReportAgentId.value,
      kind: 'report',
    });
    agentReportBody.value = '';
  });
}

async function sendOrchestratorMessage() {
  if (!activeTeam.value || !orchMessage.value.trim()) return;
  await runWithError(async () => {
    const teamId = activeTeam.value!.id;
    const body = orchMessage.value.trim();
    if (orchTargetAgentId.value) {
      await api.postMessage(teamId, body, 'orchestrator_to_agent', {
        to_agent_id: orchTargetAgentId.value,
        kind: 'directive',
      });
    } else {
      await api.postMessage(teamId, body, 'broadcast', { kind: 'directive' });
    }
    orchMessage.value = '';
  });
}
</script>
