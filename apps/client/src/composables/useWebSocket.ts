import { ref, onMounted, onUnmounted } from 'vue';
import type { HookEvent, WebSocketMessage } from '../types';
import type { OrchestrationSnapshot } from '../orchestrationTypes';

export function useWebSocket(url: string) {
  const events = ref<HookEvent[]>([]);
  const orchestration = ref<OrchestrationSnapshot | null>(null);
  const isConnected = ref(false);
  const error = ref<string | null>(null);
  
  let ws: WebSocket | null = null;
  let reconnectTimeout: number | null = null;
  
  // Get max events from environment variable or use default
  const maxEvents = parseInt(import.meta.env.VITE_MAX_EVENTS_TO_DISPLAY || '300');
  
  const connect = () => {
    try {
      ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        isConnected.value = true;
        error.value = null;
      };
      
      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'initial') {
            const initialEvents = Array.isArray(message.data) ? message.data : [];
            // Only keep the most recent events up to maxEvents
            events.value = initialEvents.slice(-maxEvents);
          } else if (message.type === 'orchestration_state') {
            const raw = message.data as OrchestrationSnapshot;
            orchestration.value = {
              ...raw,
              task_transitions: raw.task_transitions ?? [],
              task_runs: (raw.task_runs ?? []).map((r) => ({
                ...r,
                run_id: r.run_id ?? r.task_id,
                termination_reason: r.termination_reason ?? null,
              })),
              execution_policies: raw.execution_policies ?? [],
              execution_environment_kind:
                raw.execution_environment_kind ?? 'simulated',
            };
          } else if (message.type === 'event') {
            const newEvent = message.data as HookEvent;
            events.value.push(newEvent);
            
            // Limit events array to maxEvents, removing the oldest when exceeded
            if (events.value.length > maxEvents) {
              events.value = events.value.slice(-maxEvents);
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };
      
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        error.value = 'WebSocket connection error';
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        isConnected.value = false;
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeout = window.setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 3000);
      };
    } catch (err) {
      console.error('Failed to connect:', err);
      error.value = 'Failed to connect to server';
    }
  };
  
  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    
    if (ws) {
      ws.close();
      ws = null;
    }
  };
  
  onMounted(() => {
    connect();
  });
  
  onUnmounted(() => {
    disconnect();
  });

  const clearEvents = () => {
    events.value = [];
  };

  return {
    events,
    orchestration,
    isConnected,
    error,
    clearEvents
  };
}