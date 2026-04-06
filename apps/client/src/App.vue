<template>
  <div class="h-screen flex flex-col bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)]">
    <header class="short:hidden border-b border-[var(--theme-primary-dark)]/20 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.28),_transparent_36%),linear-gradient(115deg,var(--theme-primary-dark),var(--theme-primary),var(--theme-primary-light))] shadow-lg">
      <div class="px-3 py-4 mobile:py-1.5 mobile:px-2 flex items-center justify-between mobile:gap-2">
        <!-- Title Section - Hidden on mobile -->
        <div class="flex flex-col gap-2 min-w-0 mobile:min-w-0">
          <div class="flex flex-wrap items-center gap-3 min-w-0">
            <h1 class="text-xl sm:text-2xl font-bold text-white drop-shadow-lg truncate">
              Multi-Agent Command Center
            </h1>
            <nav
              class="flex shrink-0 rounded-lg bg-white/15 p-0.5 text-[11px] sm:text-sm font-semibold backdrop-blur border border-white/20"
              aria-label="Primary views"
            >
              <button
                type="button"
                class="px-2.5 sm:px-3 py-1 rounded-md transition-colors"
                :class="
                  activeSurface === 'observe'
                    ? 'bg-white text-[var(--theme-primary)] shadow'
                    : 'text-white/90 hover:bg-white/10'
                "
                @click="activeSurface = 'observe'"
              >
                Observability
              </button>
              <button
                type="button"
                class="px-2.5 sm:px-3 py-1 rounded-md transition-colors"
                :class="
                  activeSurface === 'orchestrate'
                    ? 'bg-white text-[var(--theme-primary)] shadow'
                    : 'text-white/90 hover:bg-white/10'
                "
                @click="activeSurface = 'orchestrate'"
              >
                Orchestration
              </button>
            </nav>
          </div>
          <p class="hidden sm:block text-xs text-white/80 font-medium -mt-1">
            Live hook telemetry + parallel agent control plane
          </p>
        </div>

        <!-- Connection Status -->
        <div class="flex items-center mobile:space-x-1 space-x-1.5">
          <div v-if="isConnected" class="flex items-center mobile:space-x-0.5 space-x-1.5">
            <span class="relative flex mobile:h-2 mobile:w-2 h-3 w-3">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full mobile:h-2 mobile:w-2 h-3 w-3 bg-green-500"></span>
            </span>
            <span class="text-base mobile:text-xs text-white font-semibold drop-shadow-md mobile:hidden">Connected</span>
          </div>
          <div v-else class="flex items-center mobile:space-x-0.5 space-x-1.5">
            <span class="relative flex mobile:h-2 mobile:w-2 h-3 w-3">
              <span class="relative inline-flex rounded-full mobile:h-2 mobile:w-2 h-3 w-3 bg-red-500"></span>
            </span>
            <span class="text-base mobile:text-xs text-white font-semibold drop-shadow-md mobile:hidden">Disconnected</span>
          </div>
        </div>

        <!-- Event Count and Theme Toggle -->
        <div class="flex items-center mobile:space-x-1 space-x-2">
          <span class="text-base mobile:text-xs text-white font-semibold drop-shadow-md bg-[var(--theme-primary-dark)]/75 mobile:px-2 mobile:py-0.5 px-3 py-1.5 rounded-full border border-white/30">
            {{ events.length }}
          </span>

          <!-- Clear Button -->
          <button
            @click="handleClearClick"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            title="Clear events"
          >
            <span class="text-2xl mobile:text-base">🗑️</span>
          </button>

          <!-- Filters Toggle Button -->
          <button
            @click="showFilters = !showFilters"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            :title="showFilters ? 'Hide filters' : 'Show filters'"
          >
            <span class="text-2xl mobile:text-base">📊</span>
          </button>

          <!-- Theme Manager Button -->
          <button
            @click="handleThemeManagerClick"
            class="p-3 mobile:p-1 rounded-lg bg-white/20 hover:bg-white/30 transition-all duration-200 border border-white/30 hover:border-white/50 backdrop-blur-sm shadow-lg hover:shadow-xl"
            title="Open theme manager"
          >
            <span class="text-2xl mobile:text-base">🎨</span>
          </button>
        </div>
      </div>
    </header>

    <section class="border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)]/90 px-4 py-3 backdrop-blur-sm mobile:px-3">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-1">
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--theme-text-tertiary)]">
            {{ activeSurface === 'observe' ? 'Telemetry posture' : 'Execution posture' }}
          </p>
          <h2 class="text-lg font-semibold tracking-tight">
            {{ activeSurface === 'observe' ? 'Watch hooks, sessions, and tool flow in real time' : 'Run teams with clearer operational context' }}
          </h2>
          <p class="text-sm text-[var(--theme-text-tertiary)]">
            {{ surfaceLead }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] px-3 py-1.5 font-medium text-[var(--theme-text-secondary)]">
            {{ activeSurface === 'observe' ? 'Live stream' : 'Control plane' }}
          </span>
          <span
            class="rounded-full px-3 py-1.5 font-medium"
            :class="
              isConnected
                ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-700 border border-rose-500/30'
            "
          >
            {{ isConnected ? 'Socket healthy' : 'Socket reconnecting' }}
          </span>
        </div>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="card in surfaceSummaryCards"
          :key="card.label"
          class="rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-4 py-3 shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">
                {{ card.label }}
              </p>
              <p class="mt-2 text-2xl font-semibold tracking-tight">
                {{ card.value }}
              </p>
            </div>
            <span class="rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="card.badgeClass">
              {{ card.badge }}
            </span>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-[var(--theme-text-tertiary)]">
            {{ card.help }}
          </p>
        </article>
      </div>

      <div
        v-if="showObservabilityOnboarding"
        class="mt-4 rounded-2xl border border-dashed border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)]/70 p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="max-w-2xl">
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--theme-text-tertiary)]">
              First signal guide
            </p>
            <h3 class="mt-1 text-base font-semibold tracking-tight">
              Bring your first project into the stream
            </h3>
            <p class="mt-2 text-sm leading-relaxed text-[var(--theme-text-tertiary)]">
              This surface becomes useful once a Claude Code session is emitting hook events. Start with one connected repo,
              verify the stream, then expand to orchestration once you trust the telemetry.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-xl bg-[var(--theme-primary)] px-3 py-2 text-sm font-medium text-white"
              @click="showFilters = true"
            >
              Open filters
            </button>
            <button
              type="button"
              class="rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm font-medium"
              @click="activeSurface = 'orchestrate'"
            >
              Go to orchestration
            </button>
          </div>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <article
            v-for="step in observabilityOnboardingSteps"
            :key="step.title"
            class="rounded-2xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-4 py-3 shadow-sm"
          >
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text-tertiary)]">
              {{ step.step }}
            </p>
            <h4 class="mt-2 text-base font-semibold tracking-tight">{{ step.title }}</h4>
            <p class="mt-2 text-sm leading-relaxed text-[var(--theme-text-tertiary)]">{{ step.body }}</p>
          </article>
        </div>
      </div>
    </section>
    
    <template v-if="activeSurface === 'observe'">
    <!-- Filters -->
    <FilterPanel
      v-if="showFilters"
      class="short:hidden"
      :filters="filters"
      @update:filters="filters = $event"
    />
    
    <!-- Live Pulse Chart -->
    <LivePulseChart
      :events="events"
      :filters="filters"
      @update-unique-apps="uniqueAppNames = $event"
      @update-all-apps="allAppNames = $event"
      @update-time-range="currentTimeRange = $event"
    />

    <!-- Agent Swim Lane Container (below pulse chart, full width, hidden when empty) -->
    <div v-if="selectedAgentLanes.length > 0" class="w-full bg-[var(--theme-bg-secondary)] px-3 py-4 mobile:px-2 mobile:py-2 overflow-hidden">
      <AgentSwimLaneContainer
        :selected-agents="selectedAgentLanes"
        :events="events"
        :time-range="currentTimeRange"
        @update:selected-agents="selectedAgentLanes = $event"
      />
    </div>
    
    <!-- Timeline -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <EventTimeline
        :events="events"
        :filters="filters"
        :unique-app-names="uniqueAppNames"
        :all-app-names="allAppNames"
        v-model:stick-to-bottom="stickToBottom"
        @select-agent="toggleAgentLane"
      />
    </div>
    
    <!-- Stick to bottom button -->
    <StickScrollButton
      class="short:hidden"
      :stick-to-bottom="stickToBottom"
      @toggle="stickToBottom = !stickToBottom"
    />
    </template>

    <OrchestrationPanel
      v-else
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
      :snapshot="orchestration"
      :hook-events="events"
      @snapshot="onOrchestrationSnapshot"
    />
    
    <!-- Error message -->
    <div
      v-if="error"
      class="fixed bottom-4 left-4 mobile:bottom-3 mobile:left-3 mobile:right-3 bg-red-100 border border-red-400 text-red-700 px-3 py-2 mobile:px-2 mobile:py-1.5 rounded mobile:text-xs"
    >
      {{ error }}
    </div>
    
    <!-- Theme Manager -->
    <ThemeManager
      :is-open="showThemeManager"
      @close="showThemeManager = false"
    />

    <!-- Toast Notifications -->
    <ToastNotification
      v-for="(toast, index) in toasts"
      :key="toast.id"
      :index="index"
      :agent-name="toast.agentName"
      :agent-color="toast.agentColor"
      @dismiss="dismissToast(toast.id)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { TimeRange } from './types';
import { useWebSocket } from './composables/useWebSocket';
import { useThemes } from './composables/useThemes';
import { useEventColors } from './composables/useEventColors';
import EventTimeline from './components/EventTimeline.vue';
import FilterPanel from './components/FilterPanel.vue';
import StickScrollButton from './components/StickScrollButton.vue';
import LivePulseChart from './components/LivePulseChart.vue';
import ThemeManager from './components/ThemeManager.vue';
import ToastNotification from './components/ToastNotification.vue';
import AgentSwimLaneContainer from './components/AgentSwimLaneContainer.vue';
import OrchestrationPanel from './components/orchestration/OrchestrationPanel.vue';
import { WS_URL } from './config';
import type { OrchestrationSnapshot } from './orchestrationTypes';
import {
  buildObservabilitySummary,
  buildOrchestrationSummary,
} from './utils/commandCenterSummary';

// WebSocket connection
const { events, orchestration, isConnected, error, clearEvents } = useWebSocket(WS_URL);

const ACTIVE_SURFACE_STORAGE_KEY = 'command_center_active_surface';
const activeSurface = ref<'observe' | 'orchestrate'>('observe');

function onOrchestrationSnapshot(snapshot: OrchestrationSnapshot) {
  orchestration.value = snapshot;
}

// Theme management (sets up theme system)
useThemes();

// Event colors
const { getHexColorForApp } = useEventColors();

// Filters
const filters = ref({
  sourceApp: '',
  sessionId: '',
  eventType: ''
});

// UI state
const stickToBottom = ref(true);
const showThemeManager = ref(false);
const showFilters = ref(false);
const uniqueAppNames = ref<string[]>([]); // Apps active in current time window
const allAppNames = ref<string[]>([]); // All apps ever seen in session
const selectedAgentLanes = ref<string[]>([]);
const currentTimeRange = ref<TimeRange>('1m'); // Current time range from LivePulseChart

onMounted(() => {
  try {
    const storedSurface = window.localStorage.getItem(ACTIVE_SURFACE_STORAGE_KEY);
    if (storedSurface === 'observe' || storedSurface === 'orchestrate') {
      activeSurface.value = storedSurface;
    }
  } catch {
    /* ignore storage failures */
  }
});

watch(activeSurface, (surface) => {
  try {
    window.localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, surface);
  } catch {
    /* ignore storage failures */
  }
});

const observabilitySummary = computed(() => buildObservabilitySummary(events.value));
const orchestrationSummary = computed(() => buildOrchestrationSummary(orchestration.value));

function formatRelativeTimestamp(timestamp: number | null): string {
  if (timestamp == null) return 'Waiting for the first signal';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 10) return 'Updated just now';
  if (deltaSeconds < 60) return `Updated ${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `Updated ${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  return `Updated ${deltaHours}h ago`;
}

const surfaceLead = computed(() => {
  if (activeSurface.value === 'observe') {
    const summary = observabilitySummary.value;
    const dominantHook = summary.dominantHookType ?? 'No hook trend yet';
    return `${formatRelativeTimestamp(summary.latestEventAt)} · dominant hook: ${dominantHook}`;
  }

  const summary = orchestrationSummary.value;
  if (!orchestration.value) {
    return 'Waiting for orchestration snapshot from the server.';
  }
  return `${summary.runningTeams} of ${summary.totalTeams} teams active · ${summary.attentionTasks} tasks currently need operator attention`;
});

const surfaceSummaryCards = computed(() => {
  if (activeSurface.value === 'observe') {
    const summary = observabilitySummary.value;
    return [
      {
        label: 'Tracked agents',
        value: summary.trackedAgents,
        badge: 'Coverage',
        badgeClass: 'bg-sky-500/10 text-sky-700',
        help: 'Distinct source apps currently represented in the event stream.',
      },
      {
        label: 'Live sessions',
        value: summary.activeSessions,
        badge: 'Concurrency',
        badgeClass: 'bg-indigo-500/10 text-indigo-700',
        help: 'Unique Claude Code sessions active in this dashboard view.',
      },
      {
        label: 'Tool calls',
        value: summary.toolCalls,
        badge: 'Flow',
        badgeClass: 'bg-emerald-500/10 text-emerald-700',
        help: 'Pre/Post tool events captured across the live telemetry window.',
      },
      {
        label: 'Approval prompts',
        value: summary.approvalRequests,
        badge: 'Risk',
        badgeClass: 'bg-amber-500/10 text-amber-700',
        help: 'Permission and HITL prompts that required explicit operator attention.',
      },
    ];
  }

  const summary = orchestrationSummary.value;
  return [
    {
      label: 'Running teams',
      value: summary.runningTeams,
      badge: 'Exec',
      badgeClass: 'bg-emerald-500/10 text-emerald-700',
      help: 'Teams actively executing work right now.',
    },
    {
      label: 'Tracked agents',
      value: summary.trackedAgents,
      badge: 'Capacity',
      badgeClass: 'bg-sky-500/10 text-sky-700',
      help: 'Agents currently registered across all orchestration teams.',
    },
    {
      label: 'Queued and running',
      value: summary.queuedTasks + summary.activeTasks,
      badge: 'Queue',
      badgeClass: 'bg-indigo-500/10 text-indigo-700',
      help: 'Work either waiting for an agent slot or executing now.',
    },
    {
      label: 'Needs attention',
      value: summary.attentionTasks,
      badge: summary.attentionTasks > 0 ? 'Review' : 'Healthy',
      badgeClass:
        summary.attentionTasks > 0
          ? 'bg-rose-500/10 text-rose-700'
          : 'bg-emerald-500/10 text-emerald-700',
      help: 'Failed, blocked, or timed-out tasks that should not be ignored.',
    },
  ];
});

const showObservabilityOnboarding = computed(
  () => activeSurface.value === 'observe' && events.value.length === 0
);

const observabilityOnboardingSteps = [
  {
    step: 'Step 1',
    title: 'Wire one project',
    body: 'Copy the observability .claude hooks into a project you already use, then point it at this dashboard.',
  },
  {
    step: 'Step 2',
    title: 'Run any normal command',
    body: 'A simple Claude Code prompt is enough to verify PreToolUse, PostToolUse, and session-level events are flowing.',
  },
  {
    step: 'Step 3',
    title: 'Validate the stream',
    body: 'Watch the pulse chart, confirm the event feed populates, then use filters to isolate a single source app or session.',
  },
];

// Toast notifications
interface Toast {
  id: number;
  agentName: string;
  agentColor: string;
}
const toasts = ref<Toast[]>([]);
let toastIdCounter = 0;
const seenAgents = new Set<string>();

// Watch for new agents and show toast
watch(uniqueAppNames, (newAppNames) => {
  // Find agents that are new (not in seenAgents set)
  newAppNames.forEach(appName => {
    if (!seenAgents.has(appName)) {
      seenAgents.add(appName);
      // Show toast for new agent
      const toast: Toast = {
        id: toastIdCounter++,
        agentName: appName,
        agentColor: getHexColorForApp(appName)
      };
      toasts.value.push(toast);
    }
  });
}, { deep: true });

const dismissToast = (id: number) => {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
  }
};

// Handle agent tag clicks for swim lanes
const toggleAgentLane = (agentName: string) => {
  const index = selectedAgentLanes.value.indexOf(agentName);
  if (index >= 0) {
    // Remove from comparison
    selectedAgentLanes.value.splice(index, 1);
  } else {
    // Add to comparison
    selectedAgentLanes.value.push(agentName);
  }
};

// Handle clear button click
const handleClearClick = () => {
  clearEvents();
  selectedAgentLanes.value = [];
};

// Debug handler for theme manager
const handleThemeManagerClick = () => {
  console.log('Theme manager button clicked!');
  showThemeManager.value = true;
};
</script>
