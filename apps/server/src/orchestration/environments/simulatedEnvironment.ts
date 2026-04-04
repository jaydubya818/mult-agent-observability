import type { ExecutionEnvironment, RunWorkloadHooks, RunWorkloadParams } from './executionEnvironment';

export class SimulatedEnvironment implements ExecutionEnvironment {
  readonly kind = 'simulated';

  runWorkload(params: RunWorkloadParams, hooks: RunWorkloadHooks): { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let completed = false;

    const finish = (terminal: Parameters<RunWorkloadHooks['onComplete']>[1]) => {
      if (completed) return;
      completed = true;
      hooks.onComplete(undefined, terminal);
    };

    hooks.onBegin();

    timer = setTimeout(() => {
      timer = null;
      if (cancelled) {
        const kind = params.resolveCancellationKind() === 'engine' ? 'engine_stopped' : 'user_cancelled';
        finish({ terminalKind: kind, runId: params.runId });
        return;
      }
      finish({ terminalKind: 'success', exitCode: 0, runId: params.runId });
    }, params.estimatedDurationMs);

    return {
      cancel: () => {
        if (cancelled || completed) return;
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
          const kind = params.resolveCancellationKind() === 'engine' ? 'engine_stopped' : 'user_cancelled';
          finish({ terminalKind: kind, runId: params.runId });
        }
      },
    };
  }
}
