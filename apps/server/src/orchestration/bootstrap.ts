import type { WsFanoutClient } from './broadcast';
import { createOrchestrationBroadcast } from './broadcast';
import { OrchestrationEngine } from './engine';
import { createExecutionEnvironment } from './environments/factory';
import { initLocalProcessConcurrencyFromPolicy } from './environments/localProcessPolicy';
import { handleOrchestrationRequest } from './http';
import { initOrchestrationSchema } from './repository';
import { runOrchestrationRetentionPrune } from './retention';
import { setExecutionEnvironmentKind } from './runtimeMeta';
import { serializeOrchestrationStateMessage } from './snapshot';

/**
 * One-time DB migrations + engine + broadcast helpers.
 * Call after `initDatabase()` so `db` is ready for orchestration tables.
 */
export function bootstrapOrchestration(wsClients: Set<WsFanoutClient>) {
  initOrchestrationSchema();
  runOrchestrationRetentionPrune();

  const { broadcastOrchestrationState, broadcastHookEvent } = createOrchestrationBroadcast(wsClients);

  const environment = createExecutionEnvironment();
  setExecutionEnvironmentKind(environment.kind);
  if (environment.kind === 'local_process') {
    initLocalProcessConcurrencyFromPolicy();
  }

  const engine = new OrchestrationEngine({
    onStateChange: broadcastOrchestrationState,
    onHookEvent: broadcastHookEvent,
    environment,
  });

  return {
    engine,
    broadcastOrchestrationState,
    /** After an orchestration HTTP mutation (non-GET), fan out fresh snapshot. */
    notifyOrchestrationMutation(reqMethod: string, responseStatus?: number) {
      if (reqMethod === 'GET') return;
      if (responseStatus != null && (responseStatus < 200 || responseStatus >= 300)) return;
      broadcastOrchestrationState();
    },
    handleOrchestrationFetch(req: Request, url: URL, corsHeaders: Record<string, string>) {
      return handleOrchestrationRequest(req, url, { engine, corsHeaders });
    },
    sendOrchestrationStateToClient(ws: WsFanoutClient) {
      try {
        ws.send(serializeOrchestrationStateMessage());
      } catch {
        wsClients.delete(ws);
      }
    },
  };
}
