/**
 * Local process execution policy: env defaults, optional persisted per-team policy (see repository),
 * and subprocess slot accounting (global ceiling + per-team limit).
 *
 * ORCH_LP_CMD_ALLOWLIST, ORCH_LP_CMD_DENYLIST, ORCH_LP_MAX_MS, ORCH_LP_MAX_CONCURRENT,
 * ORCH_LP_CWD_ALLOWLIST, ORCH_LP_ENV_ALLOWLIST, ORCH_LP_MAX_OUTPUT_BYTES
 *
 * Resolution order (documented in technical design):
 * 1. Team-linked persisted policy (`orchestration_execution_policies`) when `team.execution_policy_id` is set and adapter matches.
 * 2. (Reserved) execution profile — not implemented.
 * 3. Environment variables ORCH_LP_* on this process.
 * 4. Hardcoded safe seed (embedded denylist defaults, etc.).
 */

import path from 'node:path';
import type { EffectiveLocalProcessPolicy, ExecutionPolicy } from '../types';

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolEnv(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export type LocalProcessPolicy = {
  cmdAllowlist: string[] | null;
  cmdDenylist: Set<string>;
  maxRuntimeMs: number;
  maxConcurrent: number;
  cwdAllowlistRoots: string[];
  allowUnspecifiedCwd: boolean;
  envKeyAllowlist: string[] | null;
  maxOutputBytesTotal: number;
};

const DEFAULT_DENY = ['curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'docker', 'kubectl', 'sudo', 'su', 'chmod', 'dd'];

/** Build policy from env + hardcoded defaults only (Layer 3+4). */
export function loadLocalProcessPolicyFromEnv(): LocalProcessPolicy {
  const allow = parseList(process.env.ORCH_LP_CMD_ALLOWLIST);
  const deny = new Set([...DEFAULT_DENY, ...parseList(process.env.ORCH_LP_CMD_DENYLIST).map((s) => s.toLowerCase())]);
  const cwdRoots = parseList(process.env.ORCH_LP_CWD_ALLOWLIST).map((r) => path.resolve(r));
  const envAllow = parseList(process.env.ORCH_LP_ENV_ALLOWLIST);
  return {
    cmdAllowlist: allow.length ? allow.map((s) => s.toLowerCase()) : null,
    cmdDenylist: deny,
    maxRuntimeMs: parseIntEnv('ORCH_LP_MAX_MS', 300_000),
    maxConcurrent: parseIntEnv('ORCH_LP_MAX_CONCURRENT', 4),
    cwdAllowlistRoots: cwdRoots,
    allowUnspecifiedCwd: parseBoolEnv('ORCH_LP_ALLOW_UNSPECIFIED_CWD', true),
    envKeyAllowlist: envAllow.length ? envAllow.map((s) => s.toUpperCase()) : null,
    maxOutputBytesTotal: parseIntEnv('ORCH_LP_MAX_OUTPUT_BYTES', 256_000),
  };
}

/**
 * Map a persisted `ExecutionPolicy` row to runtime policy (Layer 1).
 * Merges row.cmd_denylist with the same built-in deny seed as env mode.
 */
export function policyFromPersistedRecord(row: ExecutionPolicy): LocalProcessPolicy {
  const allow = row.cmd_allowlist;
  const deny = new Set([
    ...DEFAULT_DENY,
    ...(row.cmd_denylist ?? []).map((s) => s.toLowerCase()),
  ]);
  const cwdRoots = (row.cwd_allowlist ?? []).map((r) => path.resolve(r));
  const envAllow = row.env_allowlist;
  return {
    cmdAllowlist: allow?.length ? allow.map((s) => s.toLowerCase()) : null,
    cmdDenylist: deny,
    maxRuntimeMs: row.max_ms,
    maxConcurrent: row.max_concurrent,
    cwdAllowlistRoots: cwdRoots,
    allowUnspecifiedCwd: true,
    envKeyAllowlist: envAllow?.length ? envAllow.map((s) => s.toUpperCase()) : null,
    maxOutputBytesTotal: row.max_output_bytes,
  };
}

export function localProcessPolicyToEffective(
  policy: LocalProcessPolicy,
  meta: { source: 'team_policy' | 'env_defaults'; policy_id?: string; policy_name?: string }
): EffectiveLocalProcessPolicy {
  return {
    source: meta.source,
    policy_id: meta.policy_id,
    policy_name: meta.policy_name,
    cmd_allowlist: policy.cmdAllowlist,
    cmd_denylist: [...policy.cmdDenylist],
    max_ms: policy.maxRuntimeMs,
    max_concurrent: policy.maxConcurrent,
    cwd_allowlist: policy.cwdAllowlistRoots,
    env_allowlist: policy.envKeyAllowlist,
    max_output_bytes: policy.maxOutputBytesTotal,
  };
}

/** Singleton env policy (tests replace via `setLocalProcessPolicyForTests`). */
let policySingleton: LocalProcessPolicy | null = null;

export function getLocalProcessPolicy(): LocalProcessPolicy {
  if (!policySingleton) policySingleton = loadLocalProcessPolicyFromEnv();
  return policySingleton;
}

export function setLocalProcessPolicyForTests(p: LocalProcessPolicy | null): void {
  policySingleton = p;
}

export function streamTailCharBudget(policy: LocalProcessPolicy): number {
  return Math.max(4096, Math.floor(policy.maxOutputBytesTotal / 2));
}

/** Global concurrent subprocess ceiling from ORCH_LP_MAX_CONCURRENT (0 = unlimited). */
const globalSlot = { inUse: 0, max: 0 };
const teamInUse = new Map<string, number>();

export function configureGlobalConcurrencyCeiling(max: number): void {
  globalSlot.max = Math.max(0, max);
}

export function tryAcquireSlots(teamId: string, policy: LocalProcessPolicy): boolean {
  const t = teamInUse.get(teamId) ?? 0;
  if (globalSlot.max > 0 && globalSlot.inUse >= globalSlot.max) return false;
  if (policy.maxConcurrent > 0 && t >= policy.maxConcurrent) return false;
  globalSlot.inUse++;
  teamInUse.set(teamId, t + 1);
  return true;
}

export function releaseSlots(teamId: string): void {
  if (globalSlot.max > 0) {
    globalSlot.inUse = Math.max(0, globalSlot.inUse - 1);
  }
  const t = teamInUse.get(teamId) ?? 0;
  if (t <= 1) teamInUse.delete(teamId);
  else teamInUse.set(teamId, t - 1);
}

/** Initialize global ceiling from env only (per-team limits come from resolved policy per launch). */
export function initLocalProcessGlobalConcurrencyFromEnv(): void {
  configureGlobalConcurrencyCeiling(parseIntEnv('ORCH_LP_MAX_CONCURRENT', 4));
}

// Alias for bootstrap/tests expecting old name
export function initLocalProcessConcurrencyFromPolicy(): void {
  initLocalProcessGlobalConcurrencyFromEnv();
}

export function resetLocalProcessTestState(): void {
  policySingleton = null;
  globalSlot.inUse = 0;
  teamInUse.clear();
  initLocalProcessGlobalConcurrencyFromEnv();
}

function basenameCmd(cmd0: string): string {
  const base = path.basename(cmd0.trim());
  return base.toLowerCase();
}

export function evaluateLocalProcessLaunch(
  policy: LocalProcessPolicy,
  cmd: string[],
  cwd: string | undefined
): { ok: true } | { ok: false; reason: string } {
  if (!cmd.length) return { ok: false, reason: 'empty command' };
  const c0 = cmd[0];
  if (typeof c0 !== 'string') return { ok: false, reason: 'invalid command argv0' };
  const b0 = basenameCmd(c0);
  if (policy.cmdDenylist.has(b0)) {
    return { ok: false, reason: `command basename "${b0}" is denylisted` };
  }
  if (policy.cmdAllowlist !== null && !policy.cmdAllowlist.includes(b0)) {
    return { ok: false, reason: `command basename "${b0}" is not on allowlist` };
  }

  if (cwd !== undefined && cwd.length > 0) {
    if (!policy.cwdAllowlistRoots.length) {
      return { ok: false, reason: 'custom cwd is not allowed (cwd allowlist empty for this policy)' };
    }
    const resolved = path.resolve(cwd);
    const okRoot = policy.cwdAllowlistRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep)
    );
    if (!okRoot) {
      return { ok: false, reason: `cwd "${cwd}" is outside allowed roots` };
    }
  } else if (!policy.allowUnspecifiedCwd) {
    return { ok: false, reason: 'cwd required but disallowed' };
  }

  return { ok: true };
}

export function mergePayloadEnv(
  policy: LocalProcessPolicy,
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> | undefined
): { ok: true; env: Record<string, string | undefined> } | { ok: false; reason: string } {
  if (!extra || !Object.keys(extra).length) {
    return { ok: true, env: { ...base } };
  }
  if (policy.envKeyAllowlist === null) {
    return { ok: false, reason: 'payload.env is not allowed (env allowlist empty for this policy)' };
  }
  for (const k of Object.keys(extra)) {
    const up = k.toUpperCase();
    const allowed = policy.envKeyAllowlist.some((prefix) => up === prefix || up.startsWith(`${prefix}_`));
    if (!allowed) {
      return { ok: false, reason: `env key "${k}" is not allowed by env allowlist` };
    }
  }
  return { ok: true, env: { ...base, ...extra } };
}
