import type { HookEvent } from '../types';
import { serializeOrchestrationStateMessage } from './snapshot';

/** Minimal WebSocket client surface used for fan-out. */
export type WsFanoutClient = { send(data: string): void };

export function createOrchestrationBroadcast(clients: Set<WsFanoutClient>) {
  function safeSend(client: WsFanoutClient, payload: string) {
    try {
      client.send(payload);
    } catch {
      clients.delete(client);
    }
  }

  function broadcastOrchestrationState(): void {
    const msg = serializeOrchestrationStateMessage();
    for (const client of clients) {
      safeSend(client, msg);
    }
  }

  function broadcastHookEvent(event: HookEvent): void {
    const msg = JSON.stringify({ type: 'event', data: event });
    for (const client of clients) {
      safeSend(client, msg);
    }
  }

  return { broadcastOrchestrationState, broadcastHookEvent };
}
