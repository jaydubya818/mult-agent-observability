/**
 * eventBridge.ts
 *
 * Bridges Claude Code hook events into the orchestration state.
 * When Claude Code uses its new agent team tools (team_create, task_create, etc.),
 * those arrive as PostToolUse events. This module parses them and updates
 * the orchestration DB automatically.
 */

import { db } from '../db';
import type { HookEvent } from '../types';
import { createTeam, createAgent, createTask, updateTask, insertMessage, upsertSandbox, getTeamById, updateAgentFromSession } from './repository';

/** Claude Code agent team tool names */
const AGENT_TEAM_TOOLS = new Set([
  'team_create', 'team_delete',
  'task_create', 'task_list', 'task_get', 'task_update',
  'send_message',
]);

/** Claude Code sandbox tool names (E2B integration) */
const SANDBOX_TOOLS = new Set([
  'sandbox_create', 'create_sandbox',
  'sandbox_list', 'list_sandboxes',
  'sandbox_run', 'sandbox_kill', 'sandbox_delete',
  'mcp_e2b_create_sandbox', 'mcp_e2b_run_command',
]);

/** Parse context window % from usage data in a hook payload */
function extractContextWindowPercent(payload: Record<string, any>): number | null {
  const usage = payload?.usage ?? payload?.context_usage ?? payload?.token_usage;
  if (!usage) return null;
  const used = usage.context_window_tokens_used ?? usage.input_tokens ?? usage.total_tokens;
  const limit = usage.context_window_tokens_limit ?? usage.context_limit;
  if (used != null && limit != null && limit > 0) {
    return Math.round((used / limit) * 1000) / 10; // one decimal
  }
  return null;
}

/** Get or auto-create the "event bridge" team for hook-driven events */
function getOrCreateEventBridgeTeam(teamId: string, teamName: string, sessionId: string): string {
  const existing = getTeamById(teamId);
  if (existing) return existing.id;

  // Note: createTeam generates its own ID, so we pass what we want as the name/description
  // and then manually insert if we need a specific ID. For now, just create with defaults.
  const team = createTeam({
    name: teamName || `Agent Team ${teamId.slice(0, 8)}`,
    description: `Auto-created from Claude Code session ${sessionId}`,
  });
  return team.id;
}

/** Get or auto-create an agent record for a Claude Code session */
function getOrCreateSessionAgent(sessionId: string, teamId: string, modelName?: string, role = 'agent'): string {
  const existing = db.prepare('SELECT id FROM orchestration_agents WHERE source_session_id = ? AND team_id = ?').get(sessionId, teamId) as any;
  if (existing) {
    // Update model if newly known
    if (modelName) {
      db.prepare('UPDATE orchestration_agents SET model_name = ?, last_seen_at = ?, updated_at = ? WHERE id = ?')
        .run(modelName, Date.now(), Date.now(), existing.id);
    }
    return existing.id;
  }

  const shortSession = sessionId.slice(0, 8);
  const modelLabel = modelName
    ? (modelName.includes('haiku') ? 'Haiku' : modelName.includes('sonnet') ? 'Sonnet' : modelName.includes('opus') ? 'Opus' : modelName)
    : 'Claude';

  const agent = createAgent({
    team_id: teamId,
    name: `${modelLabel} Agent ${shortSession}`,
    role,
    environment_kind: 'claude_code',
    metadata: {
      source_session_id: sessionId,
      model_name: modelName ?? null,
    },
  });

  if (!agent) return crypto.randomUUID();

  // Store source_session_id and model_name on the created agent
  db.prepare('UPDATE orchestration_agents SET source_session_id = ?, model_name = ?, last_seen_at = ? WHERE id = ?')
    .run(sessionId, modelName ?? null, Date.now(), agent.id);

  return agent.id;
}

/**
 * Main entry point. Call this after inserting every hook event.
 * Returns true if orchestration state was mutated (caller should broadcast).
 */
export function processHookEventForOrchestration(event: HookEvent): boolean {
  let mutated = false;

  // Update agent context window / model from any event with usage data
  if (event.model_name || event.payload?.usage) {
    const cwPct = extractContextWindowPercent(event.payload ?? {});
    if (event.model_name || cwPct !== null) {
      updateAgentFromSession(event.session_id, {
        model_name: event.model_name,
        context_window_percent: cwPct ?? undefined,
        last_seen_at: event.timestamp ?? Date.now(),
      });
    }
  }

  // Only process PostToolUse events for tool-specific logic
  if (event.hook_event_type !== 'PostToolUse') return mutated;

  const toolName = (event.payload?.tool_name ?? event.payload?.name ?? '') as string;
  const toolInput = (event.payload?.tool_input ?? event.payload?.input ?? {}) as Record<string, any>;
  const toolOutput = (event.payload?.tool_response ?? event.payload?.output ?? event.payload?.result ?? {}) as Record<string, any>;

  if (AGENT_TEAM_TOOLS.has(toolName)) {
    mutated = processAgentTeamTool(event, toolName, toolInput, toolOutput) || mutated;
  } else if (SANDBOX_TOOLS.has(toolName)) {
    mutated = processSandboxTool(event, toolName, toolInput, toolOutput) || mutated;
  }

  return mutated;
}

function processAgentTeamTool(
  event: HookEvent,
  toolName: string,
  input: Record<string, any>,
  output: Record<string, any>,
): boolean {
  const sessionId = event.session_id;
  const modelName = event.model_name;
  const now = Date.now();

  switch (toolName) {
    case 'team_create': {
      // output typically: { team_id: "...", name: "...", ... }
      const teamId = (output.team_id ?? output.id ?? input.team_id ?? input.id) as string | undefined;
      const teamName = (output.name ?? input.name ?? `Team`) as string;

      // If we have a specific team ID from output, try to get it; otherwise create new
      let actualTeamId: string;
      const existing = teamId ? getTeamById(teamId) : null;
      if (existing) {
        actualTeamId = existing.id;
      } else {
        // createTeam generates its own ID
        const newTeam = createTeam({
          name: teamName,
          description: (input.description ?? output.description ?? `Created by session ${sessionId}`) as string,
        });
        actualTeamId = newTeam.id;
      }

      // Register the calling session as orchestrator agent for this team
      getOrCreateSessionAgent(sessionId, actualTeamId, modelName, 'orchestrator');
      return true;
    }

    case 'team_delete': {
      const teamId = (input.team_id ?? input.id ?? output.team_id) as string | undefined;
      if (teamId) {
        try {
          db.prepare(`UPDATE orchestration_teams SET execution_status = 'stopped', updated_at = ? WHERE id = ?`).run(now, teamId);
          db.prepare(`UPDATE orchestration_agents SET status = 'completed', updated_at = ? WHERE team_id = ?`).run(now, teamId);
        } catch {}
        return true;
      }
      return false;
    }

    case 'task_create': {
      const taskId = (output.task_id ?? output.id ?? input.task_id) as string | undefined;
      const teamId = (input.team_id ?? output.team_id) as string | undefined;
      if (!teamId) return false;

      // Ensure team exists
      getOrCreateEventBridgeTeam(teamId, '', sessionId);

      // Only create if we have a specific task ID and it doesn't exist
      if (taskId) {
        const existingTask = db.prepare('SELECT id FROM orchestration_tasks WHERE id = ?').get(taskId) as any;
        if (!existingTask) {
          // Manually insert with specific ID since createTask generates its own
          const now = Date.now();
          const status = 'queued';
          const payload = { source_event: event.id, tool_input: input };
          try {
            db.prepare(
              `INSERT INTO orchestration_tasks (
                 id, team_id, title, description, status, priority, assignee_agent_id, payload,
                 retry_attempt, retry_next_at, retry_last_failure_class, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, ?)`
            ).run(
              taskId,
              teamId,
              (input.title ?? input.name ?? `Task ${taskId.slice(0, 8)}`) as string,
              (input.description ?? input.prompt ?? '') as string,
              status,
              (input.priority ?? 0) as number,
              JSON.stringify(payload),
              now,
              now
            );
            return true;
          } catch {
            return false;
          }
        }
      }
      return false;
    }

    case 'task_update': {
      const taskId = (input.task_id ?? input.id) as string | undefined;
      if (!taskId) return false;

      const statusMap: Record<string, string> = {
        'pending': 'queued',
        'in_progress': 'running',
        'in-progress': 'running',
        'complete': 'done',
        'completed': 'done',
        'done': 'done',
        'failed': 'failed',
        'cancelled': 'cancelled',
        'canceled': 'cancelled',
        'blocked': 'blocked',
      };

      const rawStatus = (input.status ?? output.status) as string | undefined;
      const mappedStatus = rawStatus ? (statusMap[rawStatus.toLowerCase()] ?? rawStatus) : undefined;

      const updates: Record<string, any> = {};
      if (mappedStatus) updates.status = mappedStatus;
      if (input.assignee_agent_id) updates.assignee_agent_id = input.assignee_agent_id;
      if (input.title) updates.title = input.title;

      if (Object.keys(updates).length > 0) {
        updateTask(taskId, updates as any);
        return true;
      }
      return false;
    }

    case 'send_message': {
      // Determine team context from the message or from session's known team
      const teamId = (input.team_id ?? output.team_id) as string | undefined;
      if (!teamId) return false;

      const fromAgentId = (input.from_agent_id ?? output.from_agent_id) as string | undefined;
      const toAgentId = (input.to_agent_id ?? input.to ?? output.to_agent_id) as string | undefined;
      const body = (input.message ?? input.content ?? input.body ?? JSON.stringify(input)) as string;

      insertMessage({
        team_id: teamId,
        direction: toAgentId ? 'orchestrator_to_agent' : 'broadcast',
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        body,
        kind: (input.kind ?? 'directive') as any,
        correlation_task_id: (input.task_id ?? input.correlation_task_id) as string | undefined,
      });
      return true;
    }

    case 'task_list':
    case 'task_get':
      // Read operations - no state mutation needed
      return false;
  }

  return false;
}

function processSandboxTool(
  event: HookEvent,
  toolName: string,
  input: Record<string, any>,
  output: Record<string, any>,
): boolean {
  const sessionId = event.session_id;

  if (toolName.includes('create') || toolName.includes('run')) {
    const sandboxId = (output.sandbox_id ?? output.id ?? input.sandbox_id) as string | undefined;
    if (!sandboxId) return false;

    upsertSandbox({
      id: sandboxId,
      provider: 'e2b',
      template_id: (input.template ?? input.template_id) as string | null,
      session_id: sessionId,
      url: (output.url ?? output.host) as string | null,
      status: 'running',
      metadata: { tool_input: input, created_from_tool: toolName },
    });
    return true;
  }

  if (toolName.includes('kill') || toolName.includes('delete') || toolName.includes('stop')) {
    const sandboxId = (input.sandbox_id ?? input.id) as string | undefined;
    if (!sandboxId) return false;
    upsertSandbox({ id: sandboxId, status: 'stopped' });
    return true;
  }

  // list_sandboxes: output might contain array of sandboxes
  if (toolName.includes('list')) {
    const sandboxes = (output.sandboxes ?? output.data ?? (Array.isArray(output) ? output : null)) as any[] | null;
    if (sandboxes) {
      for (const s of sandboxes) {
        const sid = s.sandbox_id ?? s.id;
        if (sid) {
          upsertSandbox({
            id: sid,
            provider: 'e2b',
            session_id: s.session_id ?? sessionId,
            url: s.url ?? s.host,
            template_id: s.template_id ?? s.template,
            status: (s.status === 'stopped' || s.status === 'error') ? s.status : 'running',
            metadata: s,
          });
        }
      }
      return true;
    }
  }

  return false;
}
