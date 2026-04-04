<template>
  <header
    class="border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)]/90 backdrop-blur px-4 py-3 flex flex-wrap items-center gap-3 justify-between"
  >
    <div>
      <h2 class="text-lg font-semibold tracking-tight">Orchestration</h2>
      <p class="text-xs text-[var(--theme-text-tertiary)] mt-0.5">
        Teams, parallel agents, tasks, and live control plane
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--theme-accent-info)] text-white shadow hover:opacity-95"
        :disabled="disabled"
        @click="$emit('seed-demo')"
      >
        Seed 2×4 demo
      </button>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-secondary)] hover:bg-[var(--theme-hover-bg)]"
        :disabled="disabled"
        @click="$emit('refresh')"
      >
        Refresh
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ disabled?: boolean }>();
defineEmits<{ 'seed-demo': []; refresh: [] }>();
</script>
