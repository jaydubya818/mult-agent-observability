import { API_BASE_URL } from '../config';

export const ORCHESTRATION_API_ROOT = `${API_BASE_URL}/api/orchestration`;

export async function parseOrchestrationJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || res.statusText);
    }
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Headers for orchestration routes that honor `ORCH_ADMIN_TOKEN` when the server is in protected mode.
 */
export function orchestrationAdminHeaders(adminToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (adminToken?.trim()) headers['x-orchestration-admin-token'] = adminToken.trim();
  return headers;
}

/**
 * GET helper for read-only admin routes (e.g. `GET /admin-audit`, `GET /admin/retention-config`).
 * Sends the admin token header when provided.
 */
export async function fetchAdminJson<T>(
  path: string,
  options: { adminToken?: string | null; searchParams?: URLSearchParams } = {}
): Promise<T> {
  const rel = path.replace(/^\/+/, '');
  const qs = options.searchParams?.toString();
  const url = `${ORCHESTRATION_API_ROOT}/${rel}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: orchestrationAdminHeaders(options.adminToken) });
  return (await parseOrchestrationJsonResponse(res)) as T;
}
