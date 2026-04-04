<template>
  <Teleport to="body">
    <div
      v-if="open && task"
      class="fixed inset-0 z-50 flex justify-end bg-black/30"
      role="presentation"
      @click.self="$emit('close')"
    >
      <aside
        class="w-full max-w-md h-full bg-[var(--theme-bg-primary)] border-l border-[var(--theme-border-primary)] shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
        @click.stop
      >
        <header class="p-4 border-b border-[var(--theme-border-primary)] flex justify-between gap-2 items-start">
          <div>
            <h3 class="text-base font-semibold leading-snug">{{ task.title }}</h3>
            <p class="text-[10px] text-[var(--theme-text-tertiary)] mt-1 font-mono">{{ task.id }}</p>
            <p class="text-[10px] text-[var(--theme-text-tertiary)] mt-1">
              Server adapter: <span class="font-mono">{{ executionEnvironmentKind }}</span>
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-sm border border-[var(--theme-border-secondary)]"
            @click="$emit('close')"
          >
            Close
          </button>
        </header>
        <div class="p-4 space-y-4 overflow-y-auto flex-1 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canCancelTask"
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--theme-accent-warning)] text-[var(--theme-bg-primary)] disabled:opacity-50"
              :disabled="cancelBusy"
              @click="$emit('cancel-task')"
            >
              Cancel running task
            </button>
          </div>

          <div>
            <span class="text-xs font-bold uppercase text-[var(--theme-text-tertiary)]">Status</span>
            <p class="mt-1">{{ task.status }} · priority {{ task.priority }}</p>
            <p v-if="task.assignee_agent_id" class="text-xs text-[var(--theme-text-tertiary)]">
              Assignee: {{ agentName(task.assignee_agent_id) }}
            </p>
            <p v-if="task.retry" class="text-xs text-[var(--theme-text-secondary)] mt-2">
              Retry: attempt {{ task.retry.attempt }} / {{ task.retry.effective.max_attempts }}
              <span class="text-[var(--theme-text-tertiary)]">
                · backoff {{ task.retry.effective.backoff_ms }}ms
                <template v-if="task.retry.effective.max_backoff_ms != null">
                  · cap {{ task.retry.effective.max_backoff_ms }}ms
                </template>
                · jitter {{ task.retry.effective.jitter }}
              </span>
              <span v-if="task.retry.next_retry_at && task.retry.next_retry_at > Date.now()" class="text-[var(--theme-text-tertiary)]">
                · next at {{ formatTs(task.retry.next_retry_at) }}
              </span>
              <span v-if="task.retry.last_failure_class" class="text-[var(--theme-text-tertiary)]">
                · last {{ task.retry.last_failure_class }}
              </span>
            </p>
          </div>

          <div v-if="taskRun" class="rounded-lg border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]/50 p-3 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-bold uppercase text-[var(--theme-text-tertiary)]">Execution</span>
              <span
                class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="runStatusBadgeClass(taskRun.status)"
              >
                {{ taskRun.status }}
              </span>
            </div>
            <button
              type="button"
              class="text-[10px] font-semibold text-[var(--theme-accent-info)] underline"
              @click="task && $emit('filter-events-to-task', task.id)"
            >
              Match event feed to this task
            </button>
            <div
              v-if="taskRun.status === 'policy_rejected'"
              class="rounded-md border border-[var(--theme-accent-error)]/35 bg-[var(--theme-accent-error)]/10 p-2 text-xs mt-2"
            >
              <p class="font-semibold text-[var(--theme-accent-error)]">Policy blocked execution</p>
              <p class="mt-1 font-mono text-[10px] text-[var(--theme-text-secondary)] break-words whitespace-pre-wrap">
                {{ policyRejectionDetail }}
              </p>
            </div>
            <dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mt-2">
              <dt class="text-[var(--theme-text-tertiary)]">Adapter</dt>
              <dd class="font-mono truncate">{{ executionEnvironmentKind }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Run id</dt>
              <dd class="font-mono text-[10px] truncate" :title="taskRun.run_id">{{ shortRunId(taskRun.run_id) }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Attempt</dt>
              <dd class="font-mono">{{ taskRun.attempt ?? 1 }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Exit code</dt>
              <dd class="font-mono">{{ taskRun.exit_code ?? '—' }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Termination</dt>
              <dd class="font-mono text-[10px]">{{ taskRun.termination_reason ?? '—' }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Duration</dt>
              <dd class="font-mono text-[10px]">{{ runDurationLabel(taskRun) }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Started</dt>
              <dd class="font-mono text-[10px]">{{ formatTs(taskRun.started_at) }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Finished</dt>
              <dd class="font-mono text-[10px]">{{ formatTs(taskRun.finished_at) }}</dd>
              <dt class="text-[var(--theme-text-tertiary)]">Bytes out / err</dt>
              <dd class="font-mono text-[10px]">{{ taskRun.stdout_bytes }} / {{ taskRun.stderr_bytes }}</dd>
            </dl>
            <p v-if="taskRun.error_message" class="text-xs text-[var(--theme-accent-error)] mt-2">
              {{ taskRun.error_message }}
            </p>
            <details v-if="taskRun.stdout_tail" class="mt-2 group">
              <summary class="text-[10px] font-bold uppercase cursor-pointer text-[var(--theme-text-tertiary)]">
                Stdout (tail)
              </summary>
              <pre
                class="mt-1 max-h-32 overflow-auto rounded border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-primary)] p-2 text-[10px] font-mono whitespace-pre-wrap"
              >{{ taskRun.stdout_tail }}</pre>
            </details>
            <details v-if="taskRun.stderr_tail" class="mt-2 group">
              <summary class="text-[10px] font-bold uppercase cursor-pointer text-[var(--theme-accent-error)]">
                Stderr (tail)
              </summary>
              <pre
                class="mt-1 max-h-32 overflow-auto rounded border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-primary)] p-2 text-[10px] font-mono whitespace-pre-wrap text-[var(--theme-accent-error)]"
              >{{ taskRun.stderr_tail }}</pre>
            </details>
            <p
              v-if="!taskRun.stdout_tail && !taskRun.stderr_tail && taskRun.status === 'completed'"
              class="text-[10px] text-[var(--theme-text-tertiary)]"
            >
              No captured output (simulated or quiet command).
            </p>
          </div>
          <p v-else class="text-xs text-[var(--theme-text-tertiary)]">No execution record for this task yet.</p>

          <div>
            <span class="text-xs font-bold uppercase text-[var(--theme-text-tertiary)]">Transition history</span>
            <p v-if="!transitions.length" class="text-xs text-[var(--theme-text-tertiary)] mt-1">No transitions recorded.</p>
            <ul v-else class="mt-2 space-y-2 text-xs">
              <li v-for="tr in transitions" :key="tr.id" class="border-l-2 pl-2 border-[var(--theme-primary)]">
                <div class="text-[var(--theme-text-tertiary)]">
                  {{ formatOrchestrationTime(tr.created_at) }}
                </div>
                <div>
                  <span class="font-mono">{{ tr.from_status ?? '∅' }}</span>
                  →
                  <span class="font-mono font-semibold">{{ tr.to_status }}</span>
                  <span v-if="tr.agent_id" class="text-[var(--theme-text-tertiary)]">
                    · {{ agentName(tr.agent_id) }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  OrchestrationAgent,
  OrchestrationTask,
  TaskRunRecord,
  TaskRunStatus,
  TaskTransition,
} from '../../orchestrationTypes';
import { formatOrchestrationTime } from '../../utils/orchestrationFormat';

const props = defineProps<{
  open: boolean;
  task: OrchestrationTask | null;
  transitions: TaskTransition[];
  agents: OrchestrationAgent[];
  taskRun: TaskRunRecord | null;
  executionEnvironmentKind: string;
  canCancelTask?: boolean;
  cancelBusy?: boolean;
}>();

defineEmits<{ close: []; 'cancel-task': []; 'filter-events-to-task': [taskId: string] }>();

const policyRejectionDetail = computed(() => {
  const r = props.taskRun;
  if (!r || r.status !== 'policy_rejected') return '';
  const parts = [r.termination_reason, r.error_message].filter(Boolean);
  return parts.length ? parts.join('\n') : 'No rejection detail recorded.';
});

function agentName(agentId: string): string {
  const a = props.agents.find((x) => x.id === agentId);
  return a ? a.name : agentId.slice(0, 8);
}

function formatTs(ts: number | null): string {
  if (ts == null) return '—';
  return `${new Date(ts).toLocaleString()} · ${ts}`;
}

function shortRunId(id: string): string {
  if (!id || id.length <= 12) return id || '—';
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function runDurationLabel(run: TaskRunRecord): string {
  if (run.started_at == null || run.finished_at == null) return '—';
  const ms = run.finished_at - run.started_at;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function runStatusBadgeClass(status: TaskRunStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-[var(--theme-accent-success)]/20 text-[var(--theme-accent-success)]';
    case 'failed':
    case 'policy_rejected':
      return 'bg-[var(--theme-accent-error)]/15 text-[var(--theme-accent-error)]';
    case 'cancelled':
      return 'bg-[var(--theme-accent-warning)]/20 text-[var(--theme-text-secondary)]';
    case 'timed_out':
      return 'bg-[var(--theme-accent-warning)]/25 text-[var(--theme-accent-warning)]';
    case 'running':
    case 'pending':
      return 'bg-[var(--theme-accent-info)]/15 text-[var(--theme-accent-info)]';
    default:
      return 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)]';
  }
}
</script>
