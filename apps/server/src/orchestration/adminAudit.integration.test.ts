import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import { initOrchestrationSchema, listAdminAuditRecords } from './repository';

const ADMIN_TOKEN = 'audit-integration-token-xyz-NO-LEAK';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
};

function assertNoTokenInAuditRows(rows: { metadata: Record<string, unknown> }[], token: string): void {
  const blob = JSON.stringify(rows);
  expect(blob).not.toContain(token);
}

describe('Admin mutation audit log', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    process.env.ORCH_ADMIN_TOKEN = ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-audit-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    if (prevToken === undefined) delete process.env.ORCH_ADMIN_TOKEN;
    else process.env.ORCH_ADMIN_TOKEN = prevToken;
    await new Promise((r) => setTimeout(r, 120));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('successful protected POST /policies creates success audit row; token never stored', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ name: 'audited-policy' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
    const rows = listAdminAuditRecords({ limit: 20 });
    const row = rows.find((r) => r.action === 'policy_create' && r.outcome === 'success');
    expect(row).toBeDefined();
    expect(row!.route).toContain('/api/orchestration/policies');
    expect(row!.method).toBe('POST');
    expect(row!.auth_mode).toBe('token');
    expect(row!.target_entity_type).toBe('policy');
    expect(typeof row!.target_entity_id).toBe('string');
    assertNoTokenInAuditRows(rows, ADMIN_TOKEN);
  });

  test('denied POST /policies creates denied audit row', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': 'wrong-token-value',
      },
      body: JSON.stringify({ name: 'nope' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
    const denied = listAdminAuditRecords({ outcome: 'denied', limit: 10 });
    const row = denied.find((r) => r.action === 'policy_create');
    expect(row).toBeDefined();
    expect(row!.metadata.denial).toBe('invalid_token');
    assertNoTokenInAuditRows(denied, ADMIN_TOKEN);
    assertNoTokenInAuditRows(denied, 'wrong-token-value');
  });

  test('POST /policies missing token creates denied audit with missing_token', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
    const row = listAdminAuditRecords({ outcome: 'denied', limit: 5 }).find((r) => r.action === 'policy_create');
    expect(row?.metadata.denial).toBe('missing_token');
  });

  test('invalid POST /policies (no name) creates invalid outcome after auth', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({}),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(400);
    const row = listAdminAuditRecords({ outcome: 'invalid', limit: 10 }).find((r) => r.action === 'policy_create');
    expect(row).toBeDefined();
    expect(row!.metadata.error).toBe('name_required');
  });

  test('GET /admin-audit returns records and respects action filter', async () => {
    const createReq = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ name: 'for-filter' }),
    });
    await orch.handleOrchestrationFetch(createReq, new URL(createReq.url), CORS);

    const getReq = new Request(
      'http://localhost/api/orchestration/admin-audit?action=policy_create&limit=10',
      {
        method: 'GET',
        headers: { 'x-orchestration-admin-token': ADMIN_TOKEN },
      }
    );
    const getRes = await orch.handleOrchestrationFetch(getReq, new URL(getReq.url), CORS);
    expect(getRes!.status).toBe(200);
    const j = (await getRes!.json()) as { records: { action: string }[] };
    expect(j.records.length).toBeGreaterThanOrEqual(1);
    expect(j.records.every((r) => r.action === 'policy_create')).toBe(true);
  });
});

describe('Admin audit in open mode', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    delete process.env.ORCH_ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-audit-open-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    if (prevToken === undefined) delete process.env.ORCH_ADMIN_TOKEN;
    else process.env.ORCH_ADMIN_TOKEN = prevToken;
    await new Promise((r) => setTimeout(r, 120));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('successful POST /policies logs auth_mode open_mode', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'open-audit' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
    const row = listAdminAuditRecords({ limit: 5 }).find((r) => r.action === 'policy_create');
    expect(row?.outcome).toBe('success');
    expect(row?.auth_mode).toBe('open_mode');
  });

  test('GET /admin-audit works without token in open mode', async () => {
    const getReq = new Request('http://localhost/api/orchestration/admin-audit?limit=5', { method: 'GET' });
    const getRes = await orch.handleOrchestrationFetch(getReq, new URL(getReq.url), CORS);
    expect(getRes!.status).toBe(200);
  });
});
