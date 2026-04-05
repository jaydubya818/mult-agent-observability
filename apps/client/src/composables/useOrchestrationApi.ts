import type {
  AdminAuditRecord,
  MessageDirection,
  OrchestrationSnapshot,
  RetentionConfigPayload,
  SandboxRecord,
  TaskRunHistoryRecord,
} from '../orchestrationTypes';
import {
  fetchAdminJson,
  orchestrationAdminHeaders,
  ORCHESTRATION_API_ROOT,
  parseOrchestrationJsonResponse,
} from '../utils/orchestrationHttp';

export function useOrchestrationApi() {
  return {
    async fetchSnapshot(): Promise<OrchestrationSnapshot> {
      const raw = (await parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/snapshot`)
      )) as Record<string, unknown>;
      return {
        ...raw,
        task_transitions: raw.task_transitions ?? [],
        task_runs: raw.task_runs ?? [],
        execution_policies: raw.execution_policies ?? [],
        execution_environment_kind:
          raw.execution_environment_kind ?? 'simulated',
      } as OrchestrationSnapshot;
    },

    async listTaskRunHistory(
      params: {
        team_id?: string;
        task_id?: string;
        status?: string;
        started_after?: number;
        started_before?: number;
        finished_after?: number;
        finished_before?: number;
        q?: string;
        limit?: number;
        offset?: number;
      } = {}
    ): Promise<{ runs: TaskRunHistoryRecord[]; total: number; limit: number; offset: number }> {
      const q = new URLSearchParams();
      if (params.team_id) q.set('team_id', params.team_id);
      if (params.task_id) q.set('task_id', params.task_id);
      if (params.status) q.set('status', params.status);
      if (params.started_after != null) q.set('started_after', String(params.started_after));
      if (params.started_before != null) q.set('started_before', String(params.started_before));
      if (params.finished_after != null) q.set('finished_after', String(params.finished_after));
      if (params.finished_before != null) q.set('finished_before', String(params.finished_before));
      if (params.q) q.set('q', params.q);
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.offset != null) q.set('offset', String(params.offset));
      const qs = q.toString();
      return (await parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/task-runs${qs ? `?${qs}` : ''}`)
      )) as { runs: TaskRunHistoryRecord[]; total: number; limit: number; offset: number };
    },

    async listTaskRunHistoryForTask(
      taskId: string,
      params: { limit?: number; offset?: number; q?: string; status?: string } = {}
    ): Promise<{ runs: TaskRunHistoryRecord[]; total: number; limit: number; offset: number }> {
      const q = new URLSearchParams();
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.offset != null) q.set('offset', String(params.offset));
      if (params.q) q.set('q', params.q);
      if (params.status) q.set('status', params.status);
      const qs = q.toString();
      return (await parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/tasks/${taskId}/runs${qs ? `?${qs}` : ''}`)
      )) as { runs: TaskRunHistoryRecord[]; total: number; limit: number; offset: number };
    },

    async listTeams() {
      return parseOrchestrationJsonResponse(await fetch(`${ORCHESTRATION_API_ROOT}/teams`));
    },

    async createTeam(name: string, description?: string) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description }),
        })
      );
    },

    async deleteTeam(teamId: string) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}`, { method: 'DELETE' })
      );
    },

    async seedDemo(label?: string, adminToken?: string | null) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/demo/seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...orchestrationAdminHeaders(adminToken) },
          body: JSON.stringify(label ? { label } : {}),
        })
      );
    },

    async createTask(
      teamId: string,
      payload: {
        title: string;
        description?: string;
        priority?: number;
        status?: string;
        payload?: Record<string, unknown>;
      }
    ) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );
    },

    async cancelTask(taskId: string) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/tasks/${taskId}/cancel`, { method: 'POST' })
      );
    },

    async createAgent(teamId: string, payload: { name: string; role: string }) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );
    },

    async postMessage(
      teamId: string,
      body: string,
      direction: MessageDirection,
      extras?: { to_agent_id?: string; from_agent_id?: string; kind?: string }
    ) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body,
            direction,
            to_agent_id: extras?.to_agent_id,
            from_agent_id: extras?.from_agent_id,
            kind: extras?.kind || 'directive',
          }),
        })
      );
    },

    async startExecution(teamId: string) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/execution/start`, { method: 'POST' })
      );
    },

    async stopExecution(teamId: string) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/execution/stop`, { method: 'POST' })
      );
    },

    /** When `ORCH_ADMIN_TOKEN` is set, pass the same token. Open mode: omit. */
    async listAdminAudit(
      params: {
        limit?: number;
        outcome?: string;
        action?: string;
        route?: string;
        target_entity_type?: string;
        target_entity_id?: string;
      } = {},
      adminToken?: string | null
    ): Promise<{ records: AdminAuditRecord[] }> {
      const q = new URLSearchParams();
      if (params.limit != null) q.set('limit', String(params.limit));
      if (params.outcome) q.set('outcome', params.outcome);
      if (params.action) q.set('action', params.action);
      if (params.route) q.set('route', params.route);
      if (params.target_entity_type) q.set('target_entity_type', params.target_entity_type);
      if (params.target_entity_id) q.set('target_entity_id', params.target_entity_id);
      return fetchAdminJson<{ records: AdminAuditRecord[] }>('admin-audit', {
        adminToken,
        searchParams: q,
      });
    },

    /** Same admin token semantics as `listAdminAudit`. Does not run prune. */
    async getRetentionConfig(adminToken?: string | null): Promise<{ retention: RetentionConfigPayload }> {
      return fetchAdminJson<{ retention: RetentionConfigPayload }>('admin/retention-config', {
        adminToken,
      });
    },

    /** Requires admin token when server has `ORCH_ADMIN_TOKEN` set. */
    async setTeamExecutionPolicy(
      teamId: string,
      execution_policy_id: string | null,
      adminToken?: string | null
    ) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}/execution-policy`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...orchestrationAdminHeaders(adminToken) },
          body: JSON.stringify({ execution_policy_id }),
        })
      );
    },

    /** PATCH team (name/description/policy/retry). Policy field changes require admin token when server enforces it. */
    async patchTeam(teamId: string, body: Record<string, unknown>, adminToken?: string | null) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/teams/${teamId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...orchestrationAdminHeaders(adminToken) },
          body: JSON.stringify(body),
        })
      );
    },

    /** PATCH execution policy. Requires admin token when server has `ORCH_ADMIN_TOKEN` set. */
    async patchExecutionPolicy(
      policyId: string,
      body: Record<string, unknown>,
      adminToken?: string | null
    ) {
      return parseOrchestrationJsonResponse(
        await fetch(`${ORCHESTRATION_API_ROOT}/policies/${policyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...orchestrationAdminHeaders(adminToken) },
          body: JSON.stringify(body),
        })
      );
    },

    async fetchSandboxes(filter?: { status?: string; session_id?: string }): Promise<SandboxRecord[]> {
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', filter.status);
      if (filter?.session_id) params.set('session_id', filter.session_id);
      const res = await fetch(`${ORCHESTRATION_API_ROOT}/sandboxes${params.toString() ? `?${params}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  };
}
