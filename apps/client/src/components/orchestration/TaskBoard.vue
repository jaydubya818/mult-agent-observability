<template>
  <div class="space-y-3">
    <div class="rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/80 p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">
            Execution queue
          </p>
          <h4 class="text-lg font-semibold tracking-tight">Create work with better operator context</h4>
          <p class="mt-1 text-sm text-[var(--theme-text-tertiary)]">
            Keep titles explicit, use priority to shape dispatch, and attach a shell command only when the team runs under the local process adapter.
          </p>
        </div>
        <div class="flex flex-wrap gap-2 text-[11px]">
          <span
            v-for="card in overviewCards"
            :key="card.label"
            class="rounded-full border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-1.5 text-[var(--theme-text-secondary)]"
          >
            <strong class="font-semibold text-[var(--theme-text-primary)]">{{ card.value }}</strong> {{ card.label }}
          </span>
        </div>
      </div>

      <div class="mt-4 flex items-end gap-2 flex-wrap">
        <div class="flex-1 min-w-[200px]">
          <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Task title</label>
          <input
            :value="newTaskTitle"
            class="mt-1 w-full rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm"
            placeholder="Title"
            :disabled="disabled"
            @input="$emit('update:newTaskTitle', ($event.target as HTMLInputElement).value)"
            @keydown.enter.prevent="$emit('add-task')"
          />
        </div>
        <div class="w-24">
          <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Priority</label>
          <input
            :value="newTaskPriority"
            type="number"
            class="mt-1 w-full rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm"
            :disabled="disabled"
            @input="$emit('update:newTaskPriority', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <button
          type="button"
          class="px-4 py-2 rounded-xl bg-[var(--theme-primary)] text-white text-sm font-medium disabled:opacity-50"
          :disabled="!newTaskTitle.trim() || disabled"
          @click="$emit('add-task')"
        >
          Enqueue task
        </button>
      </div>

      <div v-if="showProcessCommand" class="mt-3 rounded-xl border border-dashed border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/40 px-3 py-3">
        <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Shell command (optional)</label>
        <p class="text-[10px] text-[var(--theme-text-tertiary)] mt-0.5 mb-2">
          When set, the task runs as <span class="font-mono">sh -c "…"</span> under the local_process adapter.
        </p>
        <input
          :value="processCommand"
          class="w-full rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-2 text-sm font-mono"
          placeholder='e.g. echo hello'
          :disabled="disabled"
          @input="$emit('update:processCommand', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      <div
        v-for="col in columns"
        :key="col.status"
        class="rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/60 p-3 min-h-[180px]"
      >
        <div class="text-xs font-bold text-[var(--theme-text-tertiary)] uppercase mb-2 flex justify-between">
          <span>{{ col.label }}</span>
          <span>{{ tasksByStatus[col.status].length }}</span>
        </div>
        <ul v-if="tasksByStatus[col.status].length" class="space-y-2">
          <li
            v-for="task in tasksByStatus[col.status]"
            :key="task.id"
            role="button"
            tabindex="0"
            class="rounded-xl border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-secondary)] px-3 py-2 cursor-pointer hover:border-[var(--theme-primary)]/40"
            @click="$emit('open-task', task.id)"
            @keydown.enter="$emit('open-task', task.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="text-sm font-medium leading-snug">{{ task.title }}</div>
              <span class="rounded-full bg-[var(--theme-bg-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--theme-text-secondary)]">
                p{{ task.priority }}
              </span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--theme-text-tertiary)]">
              <span v-if="task.assignee_agent_id" class="rounded-full border border-[var(--theme-border-secondary)] px-2 py-0.5">
                agent {{ shortId(task.assignee_agent_id) }}
              </span>
              <span v-if="hasProcessCommand(task)" class="rounded-full border border-[var(--theme-border-secondary)] px-2 py-0.5">
                local run
              </span>
              <span v-if="task.retry_attempt > 0" class="rounded-full border border-[var(--theme-border-secondary)] px-2 py-0.5">
                retry {{ task.retry_attempt }}
              </span>
            </div>
          </li>
        </ul>
        <div
          v-else
          class="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]/35 px-4 text-center text-xs text-[var(--theme-text-tertiary)]"
        >
          {{ emptyStateLabel(col.label) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrchestrationTask, TaskStatus } from '../../orchestrationTypes';
import { shortId } from '../../utils/orchestrationFormat';

const props = defineProps<{
  columns: { status: TaskStatus; label: string }[];
  tasksByStatus: Record<TaskStatus, OrchestrationTask[]>;
  newTaskTitle: string;
  newTaskPriority: number;
  disabled?: boolean;
  /** Show optional shell line for `local_process` tasks */
  showProcessCommand?: boolean;
  processCommand?: string;
}>();

defineEmits<{
  'update:newTaskTitle': [v: string];
  'update:newTaskPriority': [v: number];
  'update:processCommand': [v: string];
  'add-task': [];
  'open-task': [taskId: string];
}>();

const overviewCards = computed(() => {
  const queued = props.tasksByStatus.queued.length;
  const running = props.tasksByStatus.running.length;
  const attention =
    props.tasksByStatus.failed.length +
    props.tasksByStatus.timed_out.length +
    props.tasksByStatus.blocked.length;

  return [
    { label: 'queued', value: queued },
    { label: 'running', value: running },
    { label: 'attention', value: attention },
  ];
});

function hasProcessCommand(task: OrchestrationTask): boolean {
  const command = task.payload?.command;
  return Array.isArray(command) && command.length > 0;
}

function emptyStateLabel(columnLabel: string): string {
  return `No ${columnLabel.toLowerCase()} work in this lane yet.`;
}
</script>
