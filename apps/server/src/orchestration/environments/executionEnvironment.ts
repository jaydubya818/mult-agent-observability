/** Terminal outcome independent of Error.message string matching. */
export type WorkloadTerminalKind =
  | 'success'
  | 'user_cancelled'
  | 'engine_stopped'
  | 'timed_out'
  | 'policy_rejected'
  | 'process_error';

export interface RunWorkloadResult {
  exitCode?: number | null;
  /** Prefer this over parsing Error.message when set. */
  terminalKind?: WorkloadTerminalKind;
  runId?: string;
  detail?: string;
}

export interface RunWorkloadParams {
  teamId: string;
  agentId: string;
  taskId: string;
  runId: string;
  /** Simulated duration ms — ignored by real process adapters */
  estimatedDurationMs: number;
  /** Task payload (e.g. `command: string[]`, `cwd`, `env`) for real adapters */
  taskPayload: Record<string, unknown>;
  /** Classify cancellation when the process was killed (user vs engine stop). */
  resolveCancellationKind: () => 'user' | 'engine';
}

export interface RunWorkloadHooks {
  onBegin: () => void;
  onComplete: (error?: Error, result?: RunWorkloadResult) => void;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export interface ExecutionEnvironment {
  readonly kind: string;
  runWorkload(params: RunWorkloadParams, hooks: RunWorkloadHooks): { cancel: () => void };
  /** Optional gate before assigning work (e.g. local_process concurrency). */
  tryAcquireExecutionSlot?(): boolean;
  releaseExecutionSlot?(): void;
}
