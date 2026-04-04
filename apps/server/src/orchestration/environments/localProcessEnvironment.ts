import type { ExecutionEnvironment, RunWorkloadHooks, RunWorkloadParams } from './executionEnvironment';
import {
  evaluateLocalProcessLaunch,
  mergePayloadEnv,
  releaseSlots,
  tryAcquireSlots,
} from './localProcessPolicy';
import { resolveLocalProcessPolicyForTeam } from '../repository';

const noopChunk = (): void => {};

function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | undefined,
  onChunk: (s: string) => void
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) onChunk(dec.decode(value, { stream: true }));
    }
    const tail = dec.decode();
    if (tail) onChunk(tail);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Policy-guarded `Bun.spawn`: team-resolved policy, allow/deny, cwd, env allowlist, timeout, concurrency slots, output caps.
 */
export class LocalProcessEnvironment implements ExecutionEnvironment {
  readonly kind = 'local_process';

  runWorkload(params: RunWorkloadParams, hooks: RunWorkloadHooks): { cancel: () => void } {
    const policy = resolveLocalProcessPolicyForTeam(params.teamId);
    const onOut = hooks.onStdoutChunk ?? noopChunk;
    const onErr = hooks.onStderrChunk ?? noopChunk;
    const cmd = params.taskPayload.command;

    const reject = (detail: string) => {
      queueMicrotask(() => {
        hooks.onComplete(undefined, {
          terminalKind: 'policy_rejected',
          detail,
          runId: params.runId,
        });
      });
    };

    if (!Array.isArray(cmd) || !cmd.every((x): x is string => typeof x === 'string') || cmd.length === 0) {
      reject('task payload must include non-empty command: string[]');
      return { cancel: () => {} };
    }

    if (!tryAcquireSlots(params.teamId, policy)) {
      reject(
        'max concurrent local_process executions exceeded (per-team max_concurrent and/or global ORCH_LP_MAX_CONCURRENT)'
      );
      return { cancel: () => {} };
    }

    const cwd =
      typeof params.taskPayload.cwd === 'string' && params.taskPayload.cwd.length > 0
        ? params.taskPayload.cwd
        : undefined;
    const extraEnv = asStringRecord(params.taskPayload.env);

    const launch = evaluateLocalProcessLaunch(policy, cmd, cwd);
    if (!launch.ok) {
      releaseSlots(params.teamId);
      reject(launch.reason);
      return { cancel: () => {} };
    }

    const envMerge = mergePayloadEnv(policy, process.env, extraEnv);
    if (!envMerge.ok) {
      releaseSlots(params.teamId);
      reject(envMerge.reason);
      return { cancel: () => {} };
    }

    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let cancelled = false;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (cancelled) {
        releaseSlots(params.teamId);
        const kind = params.resolveCancellationKind() === 'engine' ? 'engine_stopped' : 'user_cancelled';
        hooks.onComplete(undefined, { terminalKind: kind, runId: params.runId });
        return;
      }
      hooks.onBegin();
      try {
        proc = Bun.spawn(cmd, {
          cwd,
          env: envMerge.env,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        timeoutTimer = setTimeout(() => {
          timedOut = true;
          try {
            proc?.kill();
          } catch {
            /* ignore */
          }
        }, policy.maxRuntimeMs);

        const exitPromise = proc.exited;
        const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
        const stderr = proc.stderr as ReadableStream<Uint8Array> | undefined;
        const drainPromise = Promise.all([drainStream(stdout, onOut), drainStream(stderr, onErr)]);

        const [exitCode] = await Promise.all([exitPromise, drainPromise]);

        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }

        if (timedOut) {
          hooks.onComplete(undefined, {
            terminalKind: 'timed_out',
            detail: `exceeded ${policy.maxRuntimeMs}ms (policy max_ms)`,
            exitCode: exitCode ?? null,
            runId: params.runId,
          });
          return;
        }
        if (cancelled) {
          const kind = params.resolveCancellationKind() === 'engine' ? 'engine_stopped' : 'user_cancelled';
          hooks.onComplete(undefined, {
            terminalKind: kind,
            exitCode: exitCode ?? null,
            runId: params.runId,
          });
          return;
        }
        if (exitCode !== 0) {
          hooks.onComplete(new Error(`process exited with code ${exitCode}`), {
            terminalKind: 'process_error',
            exitCode: exitCode ?? null,
            runId: params.runId,
          });
          return;
        }
        hooks.onComplete(undefined, {
          terminalKind: 'success',
          exitCode: exitCode ?? 0,
          runId: params.runId,
        });
      } catch (e) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (timedOut) {
          hooks.onComplete(undefined, {
            terminalKind: 'timed_out',
            detail: `exceeded ${policy.maxRuntimeMs}ms (policy max_ms)`,
            runId: params.runId,
          });
          return;
        }
        if (cancelled) {
          const kind = params.resolveCancellationKind() === 'engine' ? 'engine_stopped' : 'user_cancelled';
          hooks.onComplete(undefined, { terminalKind: kind, runId: params.runId });
          return;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        hooks.onComplete(err, {
          terminalKind: 'process_error',
          exitCode: null,
          runId: params.runId,
        });
      } finally {
        releaseSlots(params.teamId);
      }
    };

    void run();

    return {
      cancel: () => {
        cancelled = true;
        try {
          proc?.kill();
        } catch {
          /* ignore */
        }
      },
    };
  }
}
