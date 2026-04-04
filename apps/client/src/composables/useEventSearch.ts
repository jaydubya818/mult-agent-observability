import { ref, computed } from 'vue';
import type { HookEvent } from '../types';

export function useEventSearch() {
  const searchPattern = ref<string>('');
  const searchError = ref<string>('');

  // Validate regex pattern
  const validateRegex = (pattern: string): { valid: boolean; error?: string } => {
    if (!pattern || pattern.trim() === '') {
      return { valid: true };
    }

    try {
      new RegExp(pattern);
      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid regex pattern';
      return { valid: false, error: errorMessage };
    }
  };

  // Extract searchable text from event
  const getSearchableText = (event: HookEvent): string => {
    const parts: string[] = [];

    // Event type
    if (event.hook_event_type) {
      parts.push(event.hook_event_type);
    }

    // Source app and session
    if (event.source_app) {
      parts.push(event.source_app);
    }
    if (event.session_id) {
      parts.push(event.session_id);
    }

    // Model name (top-level on HookEvent)
    if (event.model_name) {
      parts.push(event.model_name);
    }

    const payload = event.payload && typeof event.payload === 'object' ? event.payload : null;
    if (payload) {
      if (typeof payload.tool_name === 'string') {
        parts.push(payload.tool_name);
      }
      const toolInput = payload.tool_input;
      if (toolInput && typeof toolInput === 'object' && 'command' in toolInput && typeof (toolInput as { command: unknown }).command === 'string') {
        parts.push((toolInput as { command: string }).command);
      }
      if (typeof (payload as { file_path?: string }).file_path === 'string') {
        parts.push((payload as { file_path: string }).file_path);
      }
      if (typeof (payload as { path?: string }).path === 'string') {
        parts.push((payload as { path: string }).path);
      }
    }

    // Summary text
    if (event.summary) {
      parts.push(event.summary);
    }

    const hitl = event.humanInTheLoop;
    if (hitl?.question) {
      parts.push(hitl.question);
    }

    return parts.join(' ').toLowerCase();
  };

  // Check if event matches pattern
  const matchesPattern = (event: HookEvent, pattern: string): boolean => {
    if (!pattern || pattern.trim() === '') {
      return true;
    }

    const validation = validateRegex(pattern);
    if (!validation.valid) {
      return false;
    }

    try {
      const regex = new RegExp(pattern, 'i'); // Case-insensitive
      const searchableText = getSearchableText(event);
      return regex.test(searchableText);
    } catch {
      return false;
    }
  };

  // Filter events by pattern
  const searchEvents = (events: HookEvent[], pattern: string): HookEvent[] => {
    if (!pattern || pattern.trim() === '') {
      return events;
    }

    return events.filter(event => matchesPattern(event, pattern));
  };

  // Computed property for current error
  const hasError = computed(() => searchError.value.length > 0);

  // Update search pattern and validate
  const updateSearchPattern = (pattern: string) => {
    searchPattern.value = pattern;

    if (!pattern || pattern.trim() === '') {
      searchError.value = '';
      return;
    }

    const validation = validateRegex(pattern);
    if (!validation.valid) {
      searchError.value = validation.error || 'Invalid regex pattern';
    } else {
      searchError.value = '';
    }
  };

  // Clear search
  const clearSearch = () => {
    searchPattern.value = '';
    searchError.value = '';
  };

  return {
    searchPattern,
    searchError,
    hasError,
    validateRegex,
    matchesPattern,
    searchEvents,
    updateSearchPattern,
    clearSearch,
    getSearchableText
  };
}
