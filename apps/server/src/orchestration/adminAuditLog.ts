import {
  checkOrchestrationAdmin,
  isOrchestrationAdminTokenConfigured,
  orchestrationAdminDenialResponse,
  type OrchestrationAdminDenial,
} from './adminAuth';
import { insertAdminAuditRecord } from './repository';

export function clientIpFromRequest(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  return null;
}

export function adminAuthMode(): 'open_mode' | 'token' {
  return isOrchestrationAdminTokenConfigured() ? 'token' : 'open_mode';
}

function newAuditId(): string {
  return crypto.randomUUID();
}

/** Log and return 401 when token mode and check fails. */
export function gateOrchestrationAdminWithAudit(
  req: Request,
  url: URL,
  corsHeaders: Record<string, string>,
  audit: {
    action: string;
    target_entity_type?: string | null;
    target_entity_id?: string | null;
  }
): Response | null {
  const chk = checkOrchestrationAdmin(req);
  if (chk.ok) return null;
  const denial: OrchestrationAdminDenial = chk.denial;
  insertAdminAuditRecord({
    id: newAuditId(),
    created_at: Date.now(),
    route: url.pathname,
    method: req.method,
    action: audit.action,
    target_entity_type: audit.target_entity_type ?? null,
    target_entity_id: audit.target_entity_id ?? null,
    outcome: 'denied',
    auth_mode: 'token',
    client_ip: clientIpFromRequest(req),
    metadata: { denial: denial === 'missing_token' ? 'missing_token' : 'invalid_token' },
  });
  return orchestrationAdminDenialResponse(denial, corsHeaders);
}

export function recordAdminAuditSuccess(
  req: Request,
  url: URL,
  fields: {
    action: string;
    target_entity_type?: string | null;
    target_entity_id?: string | null;
    metadata?: Record<string, unknown>;
  }
): void {
  insertAdminAuditRecord({
    id: newAuditId(),
    created_at: Date.now(),
    route: url.pathname,
    method: req.method,
    action: fields.action,
    target_entity_type: fields.target_entity_type ?? null,
    target_entity_id: fields.target_entity_id ?? null,
    outcome: 'success',
    auth_mode: adminAuthMode(),
    client_ip: clientIpFromRequest(req),
    metadata: fields.metadata ?? {},
  });
}

export function recordAdminAuditInvalid(
  req: Request,
  url: URL,
  fields: {
    action: string;
    target_entity_type?: string | null;
    target_entity_id?: string | null;
    metadata?: Record<string, unknown>;
  }
): void {
  insertAdminAuditRecord({
    id: newAuditId(),
    created_at: Date.now(),
    route: url.pathname,
    method: req.method,
    action: fields.action,
    target_entity_type: fields.target_entity_type ?? null,
    target_entity_id: fields.target_entity_id ?? null,
    outcome: 'invalid',
    auth_mode: adminAuthMode(),
    client_ip: clientIpFromRequest(req),
    metadata: fields.metadata ?? {},
  });
}
