import { getOrchestrationSnapshot } from './repository';

/** JSON message body for WebSocket `orchestration_state`. */
export function serializeOrchestrationStateMessage(): string {
  return JSON.stringify({ type: 'orchestration_state', data: getOrchestrationSnapshot() });
}
