/**
 * Thin shared-secret gate for policy/admin orchestration mutations.
 * Replace later with real auth (OIDC, API keys per tenant, etc.).
 *
 * When `ORCH_ADMIN_TOKEN` is unset or empty: **open mode** — checks are skipped (local dev default).
 * When set: protected routes require `x-orchestration-admin-token` or `Authorization: Bearer <token>`.
 */

const JSON_HDR = { 'Content-Type': 'application/json' };

export function isOrchestrationAdminTokenConfigured(): boolean {
  const t = process.env.ORCH_ADMIN_TOKEN;
  return typeof t === 'string' && t.trim().length > 0;
}

export function extractOrchestrationAdminToken(req: Request): string | null {
  const headerTok = req.headers.get('x-orchestration-admin-token');
  if (headerTok != null && headerTok.trim() !== '') return headerTok.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const v = auth.slice(7).trim();
    if (v !== '') return v;
  }
  return null;
}

export type OrchestrationAdminDenial = 'missing_token' | 'invalid_token';

export type OrchestrationAdminCheckResult =
  | { ok: true }
  | { ok: false; denial: OrchestrationAdminDenial };

/** Same semantics as `requireOrchestrationAdmin` but exposes denial kind for audit logging. */
export function checkOrchestrationAdmin(req: Request): OrchestrationAdminCheckResult {
  if (!isOrchestrationAdminTokenConfigured()) return { ok: true };
  const expected = process.env.ORCH_ADMIN_TOKEN!.trim();
  const got = extractOrchestrationAdminToken(req);
  if (!got) return { ok: false, denial: 'missing_token' };
  if (got !== expected) return { ok: false, denial: 'invalid_token' };
  return { ok: true };
}

export function orchestrationAdminDenialResponse(
  denial: OrchestrationAdminDenial,
  corsHeaders: Record<string, string>
): Response {
  const headers = { ...corsHeaders, ...JSON_HDR };
  if (denial === 'missing_token') {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized',
        code: 'orchestration_admin_token_missing',
        message:
          'ORCH_ADMIN_TOKEN is set. Send header x-orchestration-admin-token or Authorization: Bearer <token>.',
      }),
      { status: 401, headers }
    );
  }
  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      code: 'orchestration_admin_token_invalid',
      message: 'Admin token does not match ORCH_ADMIN_TOKEN.',
    }),
    { status: 401, headers }
  );
}

/** If admin token is configured and request is not authorized, returns the 401 Response; else null. */
export function requireOrchestrationAdmin(
  req: Request,
  corsHeaders: Record<string, string>
): Response | null {
  const c = checkOrchestrationAdmin(req);
  if (c.ok) return null;
  return orchestrationAdminDenialResponse(c.denial, corsHeaders);
}
