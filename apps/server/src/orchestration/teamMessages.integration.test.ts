import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import { createTeam, initOrchestrationSchema } from './repository';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
};

describe('Team messages HTTP: team must exist', () => {
  let dbPath: string;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-msg-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 120));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('GET /teams/:id/messages 404 when team missing', async () => {
    const req = new Request('http://localhost/api/orchestration/teams/not-a-real-id/messages', {
      method: 'GET',
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(404);
  });

  test('POST /teams/:id/messages 404 when team missing', async () => {
    const req = new Request('http://localhost/api/orchestration/teams/not-a-real-id/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'hello',
        direction: 'broadcast',
      }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(404);
  });

  test('POST /teams/:id/messages 201 when team exists', async () => {
    const team = createTeam({ name: 'msg-team' });
    const req = new Request(`http://localhost/api/orchestration/teams/${team.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'hello',
        direction: 'broadcast',
      }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
  });
});
