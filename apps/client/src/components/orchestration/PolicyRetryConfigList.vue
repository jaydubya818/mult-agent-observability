<template>
  <details class="rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/30 px-2 py-1.5 text-[10px]">
    <summary class="cursor-pointer font-semibold text-[var(--theme-text-secondary)] select-none">
      Execution policy retry layers (admin)
    </summary>
    <p class="text-[var(--theme-text-tertiary)] leading-snug mt-2">
      Requires <span class="font-mono">x-orchestration-admin-token</span> when the server sets
      <span class="font-mono">ORCH_ADMIN_TOKEN</span>. Null / empty fields = inherit env → default for that policy column. Effective resolution for a
      <strong>task</strong> still depends on the team row (team beats policy per field).
    </p>

    <p v-if="!policies.length" class="text-[var(--theme-text-tertiary)] mt-2">No policies in snapshot.</p>

    <ul v-else class="mt-2 space-y-3 max-h-64 overflow-y-auto pr-1">
      <li v-for="p in policies" :key="p.id" class="rounded border border-[var(--theme-border-tertiary)]/60 p-2 space-y-1.5">
        <div class="font-medium text-[var(--theme-text-primary)] truncate" :title="p.name">{{ p.name }}</div>
        <div class="text-[var(--theme-text-tertiary)] font-mono text-[9px] truncate">{{ p.id }}</div>

        <div class="grid grid-cols-2 gap-x-2 gap-y-1">
          <input
            v-model="drafts[p.id]!.retry_max_attempts"
            type="text"
            inputmode="numeric"
            class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-0.5 font-mono text-[10px]"
            placeholder="max attempts"
            :disabled="disabled"
          />
          <input
            v-model="drafts[p.id]!.retry_backoff_ms"
            type="text"
            inputmode="numeric"
            class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-0.5 font-mono text-[10px]"
            placeholder="backoff ms"
            :disabled="disabled"
          />
          <input
            v-model="drafts[p.id]!.retry_max_backoff_ms"
            type="text"
            inputmode="numeric"
            class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-0.5 font-mono text-[10px]"
            placeholder="max backoff ms"
            :disabled="disabled"
          />
          <select
            v-model="drafts[p.id]!.retry_jitter"
            class="col-span-2 rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] px-2 py-0.5 text-[10px]"
            :disabled="disabled"
          >
            <option value="inherit">Jitter: inherit</option>
            <option value="off">off</option>
            <option value="uniform">uniform</option>
          </select>
        </div>

        <p v-if="errors[p.id]" class="text-[var(--theme-accent-error)] text-[9px]">{{ errors[p.id] }}</p>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[9px] font-semibold bg-[var(--theme-accent-info)] text-[var(--theme-bg-primary)] disabled:opacity-50"
            :disabled="disabled"
            @click="savePolicy(p.id)"
          >
            Save
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-[9px] border border-[var(--theme-border-secondary)] disabled:opacity-50"
            :disabled="disabled"
            @click="resetPolicy(p.id)"
          >
            Reset
          </button>
        </div>
      </li>
    </ul>
  </details>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { ExecutionPolicy } from '../../orchestrationTypes';
import { draftFromRetryLayer, validateAndBuildRetryPatch, type RetryFormDraft } from '../../utils/orchestrationRetryForm';

const props = defineProps<{
  policies: ExecutionPolicy[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  apply: [policyId: string, patch: Record<string, unknown>];
}>();

const drafts = reactive<Record<string, RetryFormDraft>>({});
const errors = reactive<Record<string, string | undefined>>({});
/** Last seen `updated_at` per policy; when server changes, reload draft from row. */
const prevPolicyUpdated = ref<Record<string, number>>({});

watch(
  () => props.policies,
  (list) => {
    const nextIds = new Set(list.map((p) => p.id));
    for (const id of Object.keys(drafts)) {
      if (!nextIds.has(id)) {
        delete drafts[id];
        delete errors[id];
        delete prevPolicyUpdated.value[id];
      }
    }
    for (const p of list) {
      const prev = prevPolicyUpdated.value[p.id];
      if (prev !== p.updated_at || !drafts[p.id]) {
        drafts[p.id] = draftFromRetryLayer(p);
        errors[p.id] = undefined;
        prevPolicyUpdated.value = { ...prevPolicyUpdated.value, [p.id]: p.updated_at };
      }
    }
  },
  { immediate: true, deep: true }
);

function resetPolicy(id: string) {
  const p = props.policies.find((x) => x.id === id);
  if (p) {
    drafts[id] = draftFromRetryLayer(p);
    errors[id] = undefined;
    prevPolicyUpdated.value = { ...prevPolicyUpdated.value, [id]: p.updated_at };
  }
}

function savePolicy(id: string) {
  errors[id] = undefined;
  const d = drafts[id];
  if (!d) return;
  const v = validateAndBuildRetryPatch(d);
  if (!v.ok) {
    errors[id] = v.message;
    return;
  }
  emit('apply', id, {
    retry_max_attempts: v.patch.retry_max_attempts,
    retry_backoff_ms: v.patch.retry_backoff_ms,
    retry_max_backoff_ms: v.patch.retry_max_backoff_ms,
    retry_jitter: v.patch.retry_jitter,
  });
}
</script>
