import {
  gateOrchestrationAdminWithAudit,
  recordAdminAuditInvalid,
  recordAdminAuditSuccess,
} from './adminAuditLog';
import { requireOrchestrationAdmin } from './adminAuth';
import type { OrchestrationEngine } from './engine';
import {
  createAgent,
  createExecutionPolicy,
  createTask,
  createTeam,
  deleteTeam,
  getEffectiveLocalProcessPolicyForTeam,
  getExecutionPolicyById,
  getOrchestrationSnapshot,
  getTaskById,
  getTeamById,
  getTeamSummaries,
  insertMessage,
  listAdminAuditRecords,
  listAgentsByTeam,
  listExecutionPolicies,
  listMessages,
  listMetrics,
  listTasksByTeam,
  listTeams,
  setTeamExecutionPolicy,
  updateAgent,
  updateExecutionPolicy,
  updateTask,
  updateTeam,
} from './repository';
import { runOrchestrationRetentionPrune } from './retention';
import type { MessageDirection, MessageKind, TaskStatus } from './types';

const JSON_HDR = { 'Content-Type': 'application/json' };

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HDR, ...extraHeaders },
  });
}

function parsePath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

export type OrchestrationHttpContext = {
  engine: OrchestrationEngine;
  corsHeaders: Record<string, string>;
};

/** POST /api/orchestration/tasks/:taskId/cancel */
function parseTasksCancelPath(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestration\/tasks\/([^/]+)\/cancel$/);
  return m?.[1] ?? null;
}

export async function handleOrchestrationRequest(
  req: Request,
  url: URL,
  ctx: OrchestrationHttpContext
): Promise<Response | null> {
  const parts = parsePath(url.pathname);
  if (parts[0] !== 'api' || parts[1] !== 'orchestration') return null;

  const { engine, corsHeaders } = ctx;
  const h = { ...corsHeaders, ...JSON_HDR };

  try {
    // POST /api/orchestration/demo/seed
    if (req.method === 'POST' && parts[2] === 'demo' && parts[3] === 'seed') {
      const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, { action: 'demo_seed' });
      if (denied) return denied;
      const body = await safeJson(req);
      const label = typeof body?.label === 'string' ? body.label : `demo-${Date.now()}`;
      const result = seedTwoTeamsDemo(label);
      recordAdminAuditSuccess(req, url, {
        action: 'demo_seed',
        metadata: { label, team_ids: result.teams.map((t) => t.id) },
      });
      return new Response(JSON.stringify(result), { status: 201, headers: h });
    }

    // POST /api/orchestration/teams
    if (req.method === 'POST' && parts[2] === 'teams' && parts.length === 3) {
      const body = await safeJson(req);
      if (!body?.name || typeof body.name !== 'string') {
        return json({ error: 'name is required' }, 400, h);
      }
      const hasPolicyField = Object.prototype.hasOwnProperty.call(body, 'execution_policy_id');
      if (hasPolicyField) {
        const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, {
          action: 'team_create_with_policy',
        });
        if (denied) return denied;
      }
      if (body.execution_policy_id != null && typeof body.execution_policy_id === 'string') {
        if (!getExecutionPolicyById(body.execution_policy_id)) {
          if (hasPolicyField) {
            recordAdminAuditInvalid(req, url, {
              action: 'team_create_with_policy',
              metadata: { error: 'execution_policy_id not found' },
            });
          }
          return json({ error: 'execution_policy_id not found' }, 400, h);
        }
      }
      let team;
      try {
        team = createTeam({
          name: body.name,
          description: body.description,
          execution_policy_id:
            typeof body.execution_policy_id === 'string' ? body.execution_policy_id : undefined,
        });
      } catch {
        return json({ error: 'invalid team payload' }, 400, h);
      }
      if (hasPolicyField) {
        recordAdminAuditSuccess(req, url, {
          action: 'team_create_with_policy',
          target_entity_type: 'team',
          target_entity_id: team.id,
          metadata: {
            team_name: team.name,
            execution_policy_id: team.execution_policy_id ?? null,
          },
        });
      }
      return new Response(JSON.stringify(team), { status: 201, headers: h });
    }

    // GET /api/orchestration/teams
    if (req.method === 'GET' && parts[2] === 'teams' && parts.length === 3) {
      return new Response(JSON.stringify({ teams: listTeams(), summaries: getTeamSummaries() }), {
        headers: h,
      });
    }

    // GET /api/orchestration/snapshot
    if (req.method === 'GET' && parts[2] === 'snapshot' && parts.length === 3) {
      return new Response(JSON.stringify(getOrchestrationSnapshot()), { headers: h });
    }

    // GET /api/orchestration/admin-audit
    if (req.method === 'GET' && parts[2] === 'admin-audit' && parts.length === 3) {
      const denied = requireOrchestrationAdmin(req, corsHeaders);
      if (denied) return denied;
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw != null ? parseInt(limitRaw, 10) : 100;
      const records = listAdminAuditRecords({
        limit: Number.isFinite(limit) ? limit : 100,
        outcome: url.searchParams.get('outcome') || undefined,
        action: url.searchParams.get('action') || undefined,
        route: url.searchParams.get('route') || undefined,
        target_entity_type: url.searchParams.get('target_entity_type') || undefined,
        target_entity_id: url.searchParams.get('target_entity_id') || undefined,
      });
      return json({ records }, 200, h);
    }

    // POST /api/orchestration/admin/prune-history
    if (req.method === 'POST' && parts[2] === 'admin' && parts[3] === 'prune-history' && parts.length === 4) {
      const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, { action: 'retention_prune' });
      if (denied) return denied;
      const summary = runOrchestrationRetentionPrune();
      recordAdminAuditSuccess(req, url, {
        action: 'retention_prune',
        metadata: {
          total_rows_removed: summary.total_rows_removed,
          admin_audit_removed: summary.admin_audit.removed_by_age + summary.admin_audit.removed_by_row_cap,
          task_runs_removed: summary.task_runs.removed_by_age + summary.task_runs.removed_by_row_cap,
        },
      });
      return json({ ok: true, summary }, 200, h);
    }

    // GET /api/orchestration/policies
    if (req.method === 'GET' && parts[2] === 'policies' && parts.length === 3) {
      return json({ policies: listExecutionPolicies() }, 200, h);
    }

    // POST /api/orchestration/policies
    if (req.method === 'POST' && parts[2] === 'policies' && parts.length === 3) {
      const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, {
        action: 'policy_create',
        target_entity_type: 'policy',
      });
      if (denied) return denied;
      const body = await safeJson(req);
      if (!body?.name || typeof body.name !== 'string') {
        recordAdminAuditInvalid(req, url, {
          action: 'policy_create',
          target_entity_type: 'policy',
          metadata: { error: 'name_required' },
        });
        return json({ error: 'name is required' }, 400, h);
      }
      const pol = createExecutionPolicy({
        name: body.name,
        adapter_kind: typeof body.adapter_kind === 'string' ? body.adapter_kind : undefined,
        cmd_allowlist: Array.isArray(body.cmd_allowlist) ? body.cmd_allowlist : body.cmd_allowlist === null ? null : undefined,
        cmd_denylist: Array.isArray(body.cmd_denylist) ? body.cmd_denylist : undefined,
        max_ms: typeof body.max_ms === 'number' ? body.max_ms : undefined,
        max_concurrent: typeof body.max_concurrent === 'number' ? body.max_concurrent : undefined,
        cwd_allowlist: Array.isArray(body.cwd_allowlist) ? body.cwd_allowlist : undefined,
        env_allowlist:
          body.env_allowlist === null
            ? null
            : Array.isArray(body.env_allowlist)
              ? body.env_allowlist
              : undefined,
        max_output_bytes: typeof body.max_output_bytes === 'number' ? body.max_output_bytes : undefined,
      });
      recordAdminAuditSuccess(req, url, {
        action: 'policy_create',
        target_entity_type: 'policy',
        target_entity_id: pol.id,
        metadata: { name: pol.name, adapter_kind: pol.adapter_kind },
      });
      return new Response(JSON.stringify(pol), { status: 201, headers: h });
    }

    const policyId = parts[3];
    // GET /api/orchestration/policies/:policyId
    if (req.method === 'GET' && parts[2] === 'policies' && parts.length === 4 && policyId) {
      const p = getExecutionPolicyById(policyId);
      if (!p) return json({ error: 'policy not found' }, 404, h);
      return json(p, 200, h);
    }

    // PATCH /api/orchestration/policies/:policyId
    if (req.method === 'PATCH' && parts[2] === 'policies' && parts.length === 4 && policyId) {
      const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, {
        action: 'policy_update',
        target_entity_type: 'policy',
        target_entity_id: policyId,
      });
      if (denied) return denied;
      const body = await safeJson(req);
      const updated = updateExecutionPolicy(policyId, {
        name: typeof body.name === 'string' ? body.name : undefined,
        adapter_kind: typeof body.adapter_kind === 'string' ? body.adapter_kind : undefined,
        cmd_allowlist:
          body.cmd_allowlist === null
            ? null
            : Array.isArray(body.cmd_allowlist)
              ? body.cmd_allowlist
              : undefined,
        cmd_denylist: Array.isArray(body.cmd_denylist) ? body.cmd_denylist : undefined,
        max_ms: typeof body.max_ms === 'number' ? body.max_ms : undefined,
        max_concurrent: typeof body.max_concurrent === 'number' ? body.max_concurrent : undefined,
        cwd_allowlist: Array.isArray(body.cwd_allowlist) ? body.cwd_allowlist : undefined,
        env_allowlist:
          body.env_allowlist === null
            ? null
            : Array.isArray(body.env_allowlist)
              ? body.env_allowlist
              : undefined,
        max_output_bytes: typeof body.max_output_bytes === 'number' ? body.max_output_bytes : undefined,
      });
      if (!updated) {
        recordAdminAuditInvalid(req, url, {
          action: 'policy_update',
          target_entity_type: 'policy',
          target_entity_id: policyId,
          metadata: { error: 'policy_not_found' },
        });
        return json({ error: 'policy not found' }, 404, h);
      }
      recordAdminAuditSuccess(req, url, {
        action: 'policy_update',
        target_entity_type: 'policy',
        target_entity_id: updated.id,
        metadata: { name: updated.name },
      });
      return json(updated, 200, h);
    }

    const teamId = parts[3];

    // GET /api/orchestration/teams/:teamId/effective-execution-policy
    if (
      req.method === 'GET' &&
      parts[2] === 'teams' &&
      parts[4] === 'effective-execution-policy' &&
      parts.length === 5 &&
      teamId
    ) {
      if (!getTeamById(teamId)) return json({ error: 'team not found' }, 404, h);
      return json({
        team_id: teamId,
        adapter_kind: 'local_process',
        effective: getEffectiveLocalProcessPolicyForTeam(teamId),
      });
    }

    // PATCH /api/orchestration/teams/:teamId
    if (req.method === 'PATCH' && parts[2] === 'teams' && parts.length === 4 && teamId) {
      const body = await safeJson(req);
      const patchHasPolicy = Object.prototype.hasOwnProperty.call(body, 'execution_policy_id');
      if (patchHasPolicy) {
        const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, {
          action: 'team_execution_policy_patch',
          target_entity_type: 'team',
          target_entity_id: teamId,
        });
        if (denied) return denied;
      }
      const patch: {
        name?: string;
        description?: string | null;
        execution_policy_id?: string | null;
      } = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (body.description === null || typeof body.description === 'string') patch.description = body.description;
      if (body.execution_policy_id === null || typeof body.execution_policy_id === 'string') {
        if (typeof body.execution_policy_id === 'string' && !getExecutionPolicyById(body.execution_policy_id)) {
          if (patchHasPolicy) {
            recordAdminAuditInvalid(req, url, {
              action: 'team_execution_policy_patch',
              target_entity_type: 'team',
              target_entity_id: teamId,
              metadata: { error: 'execution_policy_id not found' },
            });
          }
          return json({ error: 'execution_policy_id not found' }, 400, h);
        }
        patch.execution_policy_id = body.execution_policy_id;
      }
      const updated = updateTeam(teamId, patch);
      if (!updated) {
        if (patchHasPolicy) {
          recordAdminAuditInvalid(req, url, {
            action: 'team_execution_policy_patch',
            target_entity_type: 'team',
            target_entity_id: teamId,
            metadata: { error: 'team_not_found' },
          });
        }
        return json({ error: 'team not found' }, 404, h);
      }
      if (patchHasPolicy) {
        recordAdminAuditSuccess(req, url, {
          action: 'team_execution_policy_patch',
          target_entity_type: 'team',
          target_entity_id: teamId,
          metadata: { execution_policy_id: updated.execution_policy_id ?? null },
        });
      }
      return json(updated, 200, h);
    }

    // PUT /api/orchestration/teams/:teamId/execution-policy  (assign only; optional helper)
    if (
      req.method === 'PUT' &&
      parts[2] === 'teams' &&
      parts[4] === 'execution-policy' &&
      parts.length === 5 &&
      teamId
    ) {
      const denied = gateOrchestrationAdminWithAudit(req, url, corsHeaders, {
        action: 'team_execution_policy_put',
        target_entity_type: 'team',
        target_entity_id: teamId,
      });
      if (denied) return denied;
      const body = await safeJson(req);
      const pid = body.execution_policy_id;
      if (pid !== null && typeof pid !== 'string') {
        recordAdminAuditInvalid(req, url, {
          action: 'team_execution_policy_put',
          target_entity_type: 'team',
          target_entity_id: teamId,
          metadata: { error: 'execution_policy_id_type' },
        });
        return json({ error: 'execution_policy_id must be string or null' }, 400, h);
      }
      if (typeof pid === 'string' && !getExecutionPolicyById(pid)) {
        recordAdminAuditInvalid(req, url, {
          action: 'team_execution_policy_put',
          target_entity_type: 'team',
          target_entity_id: teamId,
          metadata: { error: 'execution_policy_id not found' },
        });
        return json({ error: 'execution_policy_id not found' }, 400, h);
      }
      const updated = setTeamExecutionPolicy(teamId, pid ?? null);
      if (!updated) {
        recordAdminAuditInvalid(req, url, {
          action: 'team_execution_policy_put',
          target_entity_type: 'team',
          target_entity_id: teamId,
          metadata: { error: 'team_not_found' },
        });
        return json({ error: 'team not found' }, 404, h);
      }
      recordAdminAuditSuccess(req, url, {
        action: 'team_execution_policy_put',
        target_entity_type: 'team',
        target_entity_id: teamId,
        metadata: { execution_policy_id: pid ?? null },
      });
      return json({
        team: updated,
        effective: getEffectiveLocalProcessPolicyForTeam(teamId),
      });
    }

    // GET /api/orchestration/teams/:teamId
    if (req.method === 'GET' && parts[2] === 'teams' && parts.length === 4 && teamId) {
      const team = getTeamById(teamId);
      if (!team) return json({ error: 'team not found' }, 404, h);
      return new Response(
        JSON.stringify({
          team,
          agents: listAgentsByTeam(teamId),
          tasks: listTasksByTeam(teamId),
          messages: listMessages(teamId, 300),
          metrics: listMetrics(teamId, 300),
        }),
        { headers: h }
      );
    }

    // DELETE /api/orchestration/teams/:teamId
    if (req.method === 'DELETE' && parts[2] === 'teams' && parts.length === 4 && teamId) {
      if (engine.isRunning(teamId)) engine.stopTeam(teamId);
      const ok = deleteTeam(teamId);
      if (!ok) return json({ error: 'team not found' }, 404, h);
      return new Response(JSON.stringify({ ok: true }), { headers: h });
    }

    // POST /api/orchestration/teams/:teamId/agents
    if (req.method === 'POST' && parts[2] === 'teams' && parts[4] === 'agents' && parts.length === 5 && teamId) {
      const body = await safeJson(req);
      if (!body?.name || !body?.role) return json({ error: 'name and role are required' }, 400, h);
      const agent = createAgent({
        team_id: teamId,
        name: String(body.name),
        role: String(body.role),
        environment_kind: body.environment_kind ? String(body.environment_kind) : undefined,
        metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : undefined,
      });
      if (!agent) return json({ error: 'team not found' }, 404, h);
      return new Response(JSON.stringify(agent), { status: 201, headers: h });
    }

    // POST /api/orchestration/teams/:teamId/tasks
    if (req.method === 'POST' && parts[2] === 'teams' && parts[4] === 'tasks' && parts.length === 5 && teamId) {
      const body = await safeJson(req);
      if (!body?.title) return json({ error: 'title is required' }, 400, h);
      const task = createTask({
        team_id: teamId,
        title: String(body.title),
        description: body.description ? String(body.description) : undefined,
        priority: typeof body.priority === 'number' ? body.priority : 0,
        status: body.status as TaskStatus | undefined,
        payload: typeof body.payload === 'object' && body.payload ? body.payload : undefined,
      });
      if (!task) return json({ error: 'team not found' }, 404, h);
      return new Response(JSON.stringify(task), { status: 201, headers: h });
    }

    // GET /api/orchestration/teams/:teamId/tasks
    if (req.method === 'GET' && parts[2] === 'teams' && parts[4] === 'tasks' && parts.length === 5 && teamId) {
      const status = url.searchParams.get('status') as TaskStatus | null;
      const tasks = listTasksByTeam(teamId, status ?? undefined);
      return new Response(JSON.stringify({ tasks }), { headers: h });
    }

    // GET /api/orchestration/teams/:teamId/messages
    if (req.method === 'GET' && parts[2] === 'teams' && parts[4] === 'messages' && parts.length === 5 && teamId) {
      const messages = listMessages(teamId, 400);
      return new Response(JSON.stringify({ messages }), { headers: h });
    }

    // POST /api/orchestration/teams/:teamId/messages
    if (req.method === 'POST' && parts[2] === 'teams' && parts[4] === 'messages' && parts.length === 5 && teamId) {
      const body = await safeJson(req);
      if (!body?.body || typeof body.body !== 'string') return json({ error: 'body is required' }, 400, h);
      const direction = body.direction as MessageDirection;
      if (
        direction !== 'orchestrator_to_agent' &&
        direction !== 'agent_to_orchestrator' &&
        direction !== 'broadcast'
      ) {
        return json({ error: 'invalid direction' }, 400, h);
      }
      const kind = (body.kind as MessageKind) || 'directive';
      const msg = insertMessage({
        team_id: teamId,
        direction,
        from_agent_id: body.from_agent_id ? String(body.from_agent_id) : undefined,
        to_agent_id: body.to_agent_id ? String(body.to_agent_id) : undefined,
        body: String(body.body),
        kind,
        correlation_task_id: body.correlation_task_id ? String(body.correlation_task_id) : undefined,
      });
      return new Response(JSON.stringify(msg), { status: 201, headers: h });
    }

    // GET /api/orchestration/teams/:teamId/metrics
    if (req.method === 'GET' && parts[2] === 'teams' && parts[4] === 'metrics' && parts.length === 5 && teamId) {
      const metrics = listMetrics(teamId, 500);
      return new Response(JSON.stringify({ metrics }), { headers: h });
    }

    // POST .../execution/start
    if (
      req.method === 'POST' &&
      parts[2] === 'teams' &&
      parts[4] === 'execution' &&
      parts[5] === 'start' &&
      parts.length === 6 &&
      teamId
    ) {
      const team = getTeamById(teamId);
      if (!team) return json({ error: 'team not found' }, 404, h);
      if (engine.isRunning(teamId)) return json({ error: 'already running' }, 409, h);
      engine.startTeam(teamId);
      return new Response(JSON.stringify({ ok: true, team_id: teamId }), { headers: h });
    }

    // POST .../execution/stop
    if (
      req.method === 'POST' &&
      parts[2] === 'teams' &&
      parts[4] === 'execution' &&
      parts[5] === 'stop' &&
      parts.length === 6 &&
      teamId
    ) {
      if (!getTeamById(teamId)) return json({ error: 'team not found' }, 404, h);
      if (engine.isRunning(teamId)) engine.stopTeam(teamId);
      return new Response(JSON.stringify({ ok: true, team_id: teamId }), { headers: h });
    }

    // PATCH /api/orchestration/agents/:agentId
    if (req.method === 'PATCH' && parts[2] === 'agents' && parts.length === 4) {
      const agentId = parts[3];
      if (!agentId) return json({ error: 'agent id required' }, 400, h);
      const body = await safeJson(req);
      const updated = updateAgent(agentId, {
        status: body.status,
        role: body.role,
        current_task_id: body.current_task_id,
        metadata: body.metadata,
      });
      if (!updated) return json({ error: 'agent not found' }, 404, h);
      return new Response(JSON.stringify(updated), { headers: h });
    }

    // GET /api/orchestration/tasks/:taskId
    if (req.method === 'GET' && parts[2] === 'tasks' && parts.length === 4) {
      const taskId = parts[3];
      if (!taskId) return json({ error: 'task id required' }, 400, h);
      const task = getTaskById(taskId);
      if (!task) return json({ error: 'task not found' }, 404, h);
      return new Response(JSON.stringify(task), { headers: h });
    }

    // PATCH /api/orchestration/tasks/:taskId
    if (req.method === 'PATCH' && parts[2] === 'tasks' && parts.length === 4) {
      const taskId = parts[3];
      if (!taskId) return json({ error: 'task id required' }, 400, h);
      const body = await safeJson(req);
      const updated = updateTask(taskId, {
        status: body.status,
        priority: body.priority,
        assignee_agent_id: body.assignee_agent_id,
        title: body.title,
        description: body.description,
        payload: body.payload,
      });
      if (!updated) return json({ error: 'task not found' }, 404, h);
      return new Response(JSON.stringify(updated), { headers: h });
    }

    const cancelId = parseTasksCancelPath(url.pathname);
    if (req.method === 'POST' && cancelId) {
      if (!getTaskById(cancelId)) return json({ error: 'task not found' }, 404, h);
      const ok = engine.cancelTask(cancelId);
      if (!ok) return json({ error: 'task is not running or has no active workload' }, 409, h);
      return new Response(JSON.stringify({ ok: true, task_id: cancelId }), { headers: h });
    }

    return null;
  } catch (e) {
    console.error('[orchestration] http', e);
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400, headers: h });
  }
}

async function safeJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function seedTwoTeamsDemo(label: string) {
  const alpha = createTeam({
    name: `${label} — Alpha Fleet`,
    description: 'Demo team A — four parallel roles',
  });
  const beta = createTeam({
    name: `${label} — Beta Grid`,
    description: 'Demo team B — four parallel roles',
  });

  const alphaAgents = [
    ['Apex Lead', 'orchestrator-proxy'],
    ['Buildbot', 'implementation'],
    ['Sentinel', 'validation'],
    ['Scout', 'research'],
  ] as const;
  const betaAgents = [
    ['Nexus Lead', 'orchestrator-proxy'],
    ['Forge', 'implementation'],
    ['Barrier', 'validation'],
    ['Vector', 'research'],
  ] as const;

  for (const [name, role] of alphaAgents) {
    createAgent({ team_id: alpha.id, name, role, metadata: { lane: 'alpha' } });
  }
  for (const [name, role] of betaAgents) {
    createAgent({ team_id: beta.id, name, role, metadata: { lane: 'beta' } });
  }

  const alphaTasks = [
    { title: 'Warm caches & verify toolchain', priority: 3 },
    { title: 'Implement auth hardening spike', priority: 2 },
    { title: 'Write smoke tests for deploy path', priority: 2 },
    { title: 'Research GPU fallback providers', priority: 1 },
    { title: 'Document rollback playbook', priority: 1 },
  ];
  const betaTasks = [
    { title: 'Normalize telemetry schema', priority: 3 },
    { title: 'Patch job runner timeouts', priority: 3 },
    { title: 'Add canary traffic split', priority: 2 },
    { title: 'Cost sweep on model routing', priority: 2 },
    { title: 'Drill incident comms templates', priority: 1 },
  ];

  for (const t of alphaTasks) {
    createTask({ team_id: alpha.id, title: t.title, priority: t.priority, status: 'backlog' });
  }
  for (const t of betaTasks) {
    createTask({ team_id: beta.id, title: t.title, priority: t.priority, status: 'backlog' });
  }

  insertMessage({
    team_id: alpha.id,
    direction: 'broadcast',
    body: 'Demo Alpha: backlog seeded — start execution to observe parallel simulated workers.',
    kind: 'system',
  });
  insertMessage({
    team_id: beta.id,
    direction: 'broadcast',
    body: 'Demo Beta: backlog seeded — start execution to observe parallel simulated workers.',
    kind: 'system',
  });

  return {
    teams: [alpha, beta],
    agentCount: 8,
    taskCount: alphaTasks.length + betaTasks.length,
  };
}
