<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--theme-text-primary)]">Parallel Agent Activity</h3>
      <span class="text-xs text-[var(--theme-text-tertiary)]">Last {{ windowMinutes }}min</span>
    </div>

    <div v-if="lanes.length === 0" class="text-center py-6 text-[var(--theme-text-tertiary)] text-xs">
      No agent activity in the last {{ windowMinutes }} minutes.
    </div>

    <div v-else class="overflow-x-auto">
      <div class="min-w-0">
        <!-- Time axis -->
        <div class="flex mb-1 text-[9px] text-[var(--theme-text-tertiary)]" style="margin-left:100px">
          <span v-for="tick in timeTicks" :key="tick.label" :style="{ width: tick.widthPct + '%' }">{{ tick.label }}</span>
        </div>

        <!-- Agent lanes -->
        <div v-for="lane in lanes" :key="lane.agentId" class="flex items-center mb-1.5 gap-2">
          <div class="w-24 shrink-0 text-[10px] text-right text-[var(--theme-text-secondary)] truncate font-medium pr-2">
            {{ lane.agentName }}
          </div>
          <div class="flex-1 relative h-5 rounded bg-[var(--theme-bg-tertiary)]">
            <div
              v-for="seg in lane.segments"
              :key="seg.key"
              class="absolute top-0.5 h-4 rounded-sm opacity-80"
              :class="seg.color"
              :style="{ left: seg.leftPct + '%', width: Math.max(seg.widthPct, 0.5) + '%' }"
              :title="seg.label"
            />
          </div>
          <span class="shrink-0 text-[10px]" :class="lane.modelBadgeClass">{{ lane.modelLabel }}</span>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-3 text-[10px] text-[var(--theme-text-tertiary)]">
      <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-blue-500 opacity-80" /><span>Running</span></div>
      <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-emerald-500 opacity-80" /><span>Done</span></div>
      <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-red-500 opacity-80" /><span>Failed</span></div>
      <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-[var(--theme-bg-quaternary)] opacity-80" /><span>Other</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrchestrationAgent, OrchestrationTask } from '../../orchestrationTypes';

const props = defineProps<{
  agents: OrchestrationAgent[];
  tasks: OrchestrationTask[];
  windowMinutes?: number;
}>();

const windowMinutes = computed(() => props.windowMinutes ?? 10);

const windowMs = computed(() => windowMinutes.value * 60 * 1000);
const nowMs = computed(() => Date.now());
const startMs = computed(() => nowMs.value - windowMs.value);

function modelLabel(modelName?: string | null): string {
  if (!modelName) return '';
  if (modelName.includes('haiku')) return 'Haiku';
  if (modelName.includes('sonnet')) return 'Sonnet';
  if (modelName.includes('opus')) return 'Opus';
  return '';
}

function modelBadgeClass(modelName?: string | null): string {
  if (!modelName) return 'text-[var(--theme-text-tertiary)]';
  if (modelName.includes('haiku')) return 'text-emerald-400';
  if (modelName.includes('sonnet')) return 'text-blue-400';
  if (modelName.includes('opus')) return 'text-purple-400';
  return 'text-[var(--theme-text-tertiary)]';
}

const timeTicks = computed(() => {
  const ticks = [];
  const segments = 5;
  for (let i = 0; i <= segments; i++) {
    const ms = startMs.value + (windowMs.value * i) / segments;
    ticks.push({
      label: new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      widthPct: 100 / segments,
    });
  }
  return ticks;
});

const lanes = computed(() => {
  const window = windowMs.value;
  const start = startMs.value;
  const now = nowMs.value;

  return props.agents.map(agent => {
    // Find tasks assigned to this agent
    const agentTasks = props.tasks.filter(t => t.assignee_agent_id === agent.id);

    const segments = agentTasks
      .map(task => {
        const taskStart = task.created_at;
        const taskEnd = task.updated_at;

        // Skip tasks entirely outside our window
        if (taskEnd < start || taskStart > now) return null;

        const clampedStart = Math.max(taskStart, start);
        const clampedEnd = Math.min(taskEnd, now);

        const leftPct = ((clampedStart - start) / window) * 100;
        const widthPct = ((clampedEnd - clampedStart) / window) * 100;

        const color = task.status === 'running' ? 'bg-blue-500'
          : task.status === 'done' ? 'bg-emerald-500'
          : task.status === 'failed' ? 'bg-red-500'
          : 'bg-[var(--theme-bg-quaternary)]';

        return {
          key: task.id,
          leftPct,
          widthPct,
          color,
          label: `${task.title} (${task.status})`,
        };
      })
      .filter(Boolean) as any[];

    // If agent is active and has no task segments, show a thin "present" dot
    if (segments.length === 0 && agent.status === 'running') {
      const lastSeen = (agent as any).last_seen_at ?? agent.updated_at;
      if (lastSeen >= start) {
        const leftPct = ((Math.max(lastSeen - 5000, start) - start) / window) * 100;
        segments.push({
          key: 'active',
          leftPct,
          widthPct: 2,
          color: 'bg-blue-400',
          label: 'Active',
        });
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      modelLabel: modelLabel((agent as any).model_name),
      modelBadgeClass: modelBadgeClass((agent as any).model_name),
      segments,
    };
  }).filter(lane => lane.segments.length > 0 || props.agents.length <= 4);
});
</script>
