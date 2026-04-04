/** Set at bootstrap so snapshots can include active execution adapter kind without circular imports. */
let executionEnvironmentKind = 'simulated';

export function setExecutionEnvironmentKind(kind: string): void {
  executionEnvironmentKind = kind;
}

export function getExecutionEnvironmentKind(): string {
  return executionEnvironmentKind;
}
