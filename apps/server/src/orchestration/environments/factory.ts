import type { ExecutionEnvironment } from './executionEnvironment';
import { LocalProcessEnvironment } from './localProcessEnvironment';
import { SimulatedEnvironment } from './simulatedEnvironment';

/**
 * Select via `ORCHESTRATION_EXECUTION_ENV`:
 * - `simulated` (default): timer-based demo workloads
 * - `local_process`: Bun subprocess per task (`payload.command`)
 */
export function createExecutionEnvironment(env?: string): ExecutionEnvironment {
  const raw = (env ?? process.env.ORCHESTRATION_EXECUTION_ENV ?? 'simulated').trim().toLowerCase();
  if (raw === 'local_process') {
    return new LocalProcessEnvironment();
  }
  return new SimulatedEnvironment();
}
