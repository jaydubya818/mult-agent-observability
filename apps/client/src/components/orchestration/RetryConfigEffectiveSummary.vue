<template>
  <div class="rounded border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)]/35 px-2 py-1.5 text-[10px] space-y-1">
    <div class="font-semibold text-[var(--theme-text-secondary)]">{{ title }}</div>
    <ul class="text-[var(--theme-text-secondary)] space-y-0.5 leading-snug">
      <li>
        Max attempts: <span class="font-mono text-[var(--theme-text-primary)]">{{ resolved.max_attempts }}</span>
      </li>
      <li>
        Backoff: <span class="font-mono text-[var(--theme-text-primary)]">{{ resolved.backoff_ms }} ms</span>
      </li>
      <li>
        Max backoff:
        <span class="font-mono text-[var(--theme-text-primary)]">{{
          resolved.max_backoff_ms != null ? `${resolved.max_backoff_ms} ms` : '— (uncapped)'
        }}</span>
      </li>
      <li>
        Jitter: <span class="font-mono text-[var(--theme-text-primary)]">{{ resolved.jitter }}</span>
      </li>
    </ul>
    <details v-if="showResolution" class="text-[var(--theme-text-tertiary)]">
      <summary class="cursor-pointer select-none hover:text-[var(--theme-text-secondary)]">Per-field source</summary>
      <ul class="mt-1 font-mono space-y-0.5 pl-1">
        <li>max_attempts ← {{ formatResolutionSource(resolved.resolution.max_attempts) }}</li>
        <li>backoff_ms ← {{ formatResolutionSource(resolved.resolution.backoff_ms) }}</li>
        <li>max_backoff_ms ← {{ formatResolutionSource(resolved.resolution.max_backoff_ms) }}</li>
        <li>jitter ← {{ formatResolutionSource(resolved.resolution.jitter) }}</li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { ResolvedTaskRetryConfig } from '../../orchestrationTypes';
import { formatResolutionSource } from '../../utils/orchestrationRetryForm';

defineProps<{
  resolved: ResolvedTaskRetryConfig;
  title?: string;
  /** When false, hide the collapsible resolution breakdown (e.g. policy row). */
  showResolution?: boolean;
}>();
</script>
