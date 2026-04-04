<template>
  <div class="space-y-3">
    <div class="flex items-end gap-2 flex-wrap">
      <div class="flex-1 min-w-[200px]">
        <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">New task</label>
        <input
          :value="newTaskTitle"
          class="mt-1 w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1.5 text-sm"
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
          class="mt-1 w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1.5 text-sm"
          :disabled="disabled"
          @input="$emit('update:newTaskPriority', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <button
        type="button"
        class="px-3 py-2 rounded-lg bg-[var(--theme-primary)] text-white text-sm font-medium disabled:opacity-50"
        :disabled="!newTaskTitle.trim() || disabled"
        @click="$emit('add-task')"
      >
        Enqueue
      </button>
    </div>

    <div v-if="showProcessCommand" class="rounded-lg border border-dashed border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/40 px-2 py-2">
      <label class="text-xs font-semibold text-[var(--theme-text-tertiary)]">Shell command (optional)</label>
      <p class="text-[10px] text-[var(--theme-text-tertiary)] mt-0.5 mb-1">
        When set, task runs as <span class="font-mono">sh -c "…"</span> under the local_process adapter.
      </p>
      <input
        :value="processCommand"
        class="w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 text-sm font-mono"
        placeholder='e.g. echo hello'
        :disabled="disabled"
        @input="$emit('update:processCommand', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      <div
        v-for="col in columns"
        :key="col.status"
        class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/60 p-3 min-h-[140px]"
      >
        <div class="text-xs font-bold text-[var(--theme-text-tertiary)] uppercase mb-2 flex justify-between">
          <span>{{ col.label }}</span>
          <span>{{ tasksByStatus[col.status].length }}</span>
        </div>
        <ul class="space-y-2">
          <li
            v-for="task in tasksByStatus[col.status]"
            :key="task.id"
            role="button"
            tabindex="0"
            class="rounded-lg border border-[var(--theme-border-tertiary)] bg-[var(--theme-bg-secondary)] px-2 py-1.5 cursor-pointer hover:border-[var(--theme-primary)]/40"
            @click="$emit('open-task', task.id)"
            @keydown.enter="$emit('open-task', task.id)"
          >
            <div class="text-sm font-medium leading-snug">{{ task.title }}</div>
            <div class="text-[10px] text-[var(--theme-text-tertiary)] flex justify-between mt-1">
              <span>p{{ task.priority }}</span>
              <span v-if="task.assignee_agent_id">agent {{ shortId(task.assignee_agent_id) }}</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OrchestrationTask, TaskStatus } from '../../orchestrationTypes';
import { shortId } from '../../utils/orchestrationFormat';

defineProps<{
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
</script>
