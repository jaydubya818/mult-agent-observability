<template>
  <div
    v-if="team"
    class="rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/40 p-2 space-y-2 text-[10px]"
  >
    <div class="font-semibold text-[var(--theme-text-secondary)]">Team retry overrides</div>
    <p class="text-[var(--theme-text-tertiary)] leading-snug">
      Empty numeric fields = inherit (clear team override). Save sends all four fields. Same admin token as policy assignment if the server enforces
      <span class="font-mono">ORCH_ADMIN_TOKEN</span> on PATCH (retry-only PATCH is open on many configs).
    </p>

    <RetryConfigEffectiveSummary :resolved="team.resolved_retry" title="Effective (resolved)" :show-resolution="true" />

    <div class="grid grid-cols-2 gap-x-2 gap-y-1.5">
      <label class="block text-[var(--theme-text-tertiary)] col-span-2">Max attempts (empty = inherit)</label>
      <input
        v-model="draft.retry_max_attempts"
        type="text"
        inputmode="numeric"
        class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono"
        placeholder="—"
        :disabled="disabled"
      />

      <label class="block text-[var(--theme-text-tertiary)] col-span-2 mt-1">Backoff ms</label>
      <input
        v-model="draft.retry_backoff_ms"
        type="text"
        inputmode="numeric"
        class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono"
        placeholder="—"
        :disabled="disabled"
      />

      <label class="block text-[var(--theme-text-tertiary)] col-span-2 mt-1">Max backoff ms (cap)</label>
      <input
        v-model="draft.retry_max_backoff_ms"
        type="text"
        inputmode="numeric"
        class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1 font-mono"
        placeholder="—"
        :disabled="disabled"
      />

      <label class="block text-[var(--theme-text-tertiary)] col-span-2 mt-1">Jitter</label>
      <select
        v-model="draft.retry_jitter"
        class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-1"
        :disabled="disabled"
      >
        <option value="inherit">Inherit</option>
        <option value="off">off</option>
        <option value="uniform">uniform</option>
      </select>
    </div>

    <p v-if="localError" class="text-[var(--theme-accent-error)] text-[10px]">{{ localError }}</p>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-[10px] font-semibold bg-[var(--theme-accent-info)] text-[var(--theme-bg-primary)] disabled:opacity-50"
        :disabled="disabled"
        @click="onSave"
      >
        Save team retry
      </button>
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-[10px] font-semibold border border-[var(--theme-border-secondary)] disabled:opacity-50"
        :disabled="disabled"
        @click="resetFromTeam"
      >
        Reset form
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { OrchestrationTeam } from '../../orchestrationTypes';
import RetryConfigEffectiveSummary from './RetryConfigEffectiveSummary.vue';
import {
  draftFromRetryLayer,
  validateAndBuildRetryPatch,
  type RetryFormDraft,
} from '../../utils/orchestrationRetryForm';

const props = defineProps<{
  team: OrchestrationTeam | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  apply: [patch: Record<string, unknown>];
}>();

const draft = ref<RetryFormDraft>({
  retry_max_attempts: '',
  retry_backoff_ms: '',
  retry_max_backoff_ms: '',
  retry_jitter: 'inherit',
});
const localError = ref<string | null>(null);
const prevTeamSyncKey = ref<string | null>(null);

function resetFromTeam() {
  const t = props.team;
  if (!t) return;
  draft.value = draftFromRetryLayer(t);
  localError.value = null;
  prevTeamSyncKey.value = `${t.id}:${t.updated_at}`;
}

watch(
  () => props.team,
  (t) => {
    if (!t) {
      prevTeamSyncKey.value = null;
      return;
    }
    const key = `${t.id}:${t.updated_at}`;
    if (prevTeamSyncKey.value !== key) {
      draft.value = draftFromRetryLayer(t);
      localError.value = null;
      prevTeamSyncKey.value = key;
    }
  },
  { immediate: true, deep: true }
);

function onSave() {
  localError.value = null;
  const v = validateAndBuildRetryPatch(draft.value);
  if (!v.ok) {
    localError.value = v.message;
    return;
  }
  emit('apply', {
    retry_max_attempts: v.patch.retry_max_attempts,
    retry_backoff_ms: v.patch.retry_backoff_ms,
    retry_max_backoff_ms: v.patch.retry_max_backoff_ms,
    retry_jitter: v.patch.retry_jitter,
  });
}
</script>
